/**
 * POST /api/trades/mtm/refresh
 *
 * Batch refresh: fetches current quotes for all open trades from Yahoo Finance,
 * persists position_price_snapshots, and updates trades.current_price.
 *
 * Rate-limited to one successful refresh every 10 seconds.
 * Failed refreshes (no open trades, provider error before any update) do NOT
 * reset the cooldown timer — the next caller can retry immediately.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db, getSqliteHandle } from '@/db';
import { trades, positionPriceSnapshots, valuationMarks, instruments, accountPositions, tradeExecutions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { resolveQuoteProvider } from '@/lib/market-data-resolver';
import { fetchYahooProfiles } from '@/lib/profile-enricher';
import { normalizeDecimal } from '@/lib/accounting/decimal';
import { rebuildAccountPerformance } from '@/lib/performance/performance-rebuild';
import { isRateLimited, markRefreshSucceeded } from './rate-limit-state';

// ── POST handler ──────────────────────────────────────────────────────

export async function POST(_request: NextRequest) {
  try {
    void _request;

    // ── Rate-limit check ──────────────────────────────────────────
    const rateLimit = isRateLimited();

    if (rateLimit.limited) {
      const retryAfter = rateLimit.retryAfter;
      return NextResponse.json(
        { error: 'Rate limited', retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfter) },
        },
      );
    }

    // ── Find open trades ──────────────────────────────────────────
    const openTrades = db
      .select({ id: trades.id, symbol: trades.symbol, direction: trades.direction, accountId: trades.accountId })
      .from(trades)
      .where(eq(trades.status, 'open'))
      .all();

    if (openTrades.length === 0) {
      // No open trades = no refresh performed. Do NOT reset the timer.
      return NextResponse.json({
        updated: 0,
        failed: [],
        timestamp: new Date().toISOString(),
      });
    }

    // ── Fetch quotes ──────────────────────────────────────────────
    const symbols = [...new Set(openTrades.map((t) => t.symbol))];
    const provider = resolveQuoteProvider();
    const quotes = await provider.getQuote(symbols);

    // ── Persist snapshots & update trade prices ───────────────────
    const quoteMap = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));
    const nowISO = new Date().toISOString();

    const failed: string[] = [];
    let updated = 0;
    const seenTrades = new Set<string>();
    const accountsWithNewMarks = new Set<string>();

    for (const trade of openTrades) {
      // Avoid double-counting trades with the same symbol
      if (seenTrades.has(trade.id)) continue;
      seenTrades.add(trade.id);

      const symbolUpper = trade.symbol.toUpperCase();
      const quote = quoteMap.get(symbolUpper);

      if (!quote || quote.price === null || quote.error) {
        failed.push(trade.symbol);
        continue;
      }

      try {
        // Persist snapshot
        db.insert(positionPriceSnapshots)
          .values({
            id: randomUUID(),
            tradeId: trade.id,
            price: quote.price,
            source: quote.source,
            marketState: quote.marketState,
            shortName: quote.shortName ?? null,
            quoteType: quote.quoteType ?? null,
            sector: quote.sector ?? null,
            industry: quote.industry ?? null,
            previousClose: quote.previousClose ?? null,
            dayHigh: quote.dayHigh ?? null,
            dayLow: quote.dayLow ?? null,
            change: quote.change ?? null,
            changePercent: quote.changePercent ?? null,
            fetchedAt: nowISO,
            createdAt: nowISO,
          })
          .run();

        // Update trade's current price
        db.update(trades)
          .set({
            currentPrice: quote.price,
            currentPriceFetchedAt: nowISO,
            updatedAt: nowISO,
          })
          .where(eq(trades.id, trade.id))
          .run();

        updated++;

        // ── Write valuation_marks row ──────────────────────────────
        try {
          let instrument = db
            .select({ id: instruments.id })
            .from(instruments)
            .where(eq(instruments.symbol, trade.symbol))
            .get();

          if (!instrument) {
            // Auto-create instrument for symbols not yet in the instruments table.
            // This can happen when a new trade uses a symbol that has never been
            // seen before. The instrument is created with sensible defaults;
            // users can update the name/type/currency later via the instrument
            // management surface.
            const instrumentId = randomUUID();
            db.insert(instruments)
              .values({
                id: instrumentId,
                symbol: trade.symbol,
                name: quote.shortName ?? trade.symbol,
                type: 'stock',
                currency: 'USD',
                createdAt: nowISO,
                updatedAt: nowISO,
              })
              .run();

            console.log(
              JSON.stringify({
                event: 'mtm-refresh.instrument.created',
                symbol: trade.symbol,
                instrumentId,
                timestamp: nowISO,
              }),
            );

            instrument = { id: instrumentId };
          }

          // ── Auto-create account position if none exists ────────────
          // When the instrument exists (found or created) but no
          // account_position row exists for (accountId, instrumentId),
          // compute the open position from trade_executions and create one.
          // Non-fatal: position creation errors do not block the
          // valuation_mark write or price refresh.
          try {
            const existingPos = db
              .select({ id: accountPositions.id })
              .from(accountPositions)
              .where(
                and(
                  eq(accountPositions.accountId, trade.accountId),
                  eq(accountPositions.instrumentId, instrument.id),
                ),
              )
              .get();

            if (!existingPos) {
              const executions = db
                .select({
                  action: tradeExecutions.action,
                  quantity: tradeExecutions.quantity,
                  price: tradeExecutions.price,
                })
                .from(tradeExecutions)
                .where(eq(tradeExecutions.tradeId, trade.id))
                .all();

              const isLong = trade.direction === 'long';
              const entryActions = executions.filter(
                (e) => isLong
                  ? (e.action === 'buy' || e.action === 'add')
                  : e.action === 'sell_short',
              );

              const totalQty = entryActions.reduce((s, e) => s + e.quantity, 0);
              const weightedCost = entryActions.reduce(
                (s, e) => s + e.price * e.quantity,
                0,
              );
              const avgCost = totalQty > 0 ? weightedCost / totalQty : quote.price;

              if (totalQty > 0) {
                db.insert(accountPositions)
                  .values({
                    id: randomUUID(),
                    accountId: trade.accountId,
                    instrumentId: instrument.id,
                    direction: trade.direction,
                    quantity: String(totalQty),
                    averageCost: String(avgCost),
                    totalCostBasis: String(totalQty * avgCost),
                    realizedGrossPnl: '0.00',
                    realizedFees: '0.00',
                    realizedNetPnl: '0.00',
                    lastUpdated: nowISO,
                  })
                  .run();

                console.log(
                  JSON.stringify({
                    event: 'mtm-refresh.position.created',
                    accountId: trade.accountId,
                    instrumentId: instrument.id,
                    tradeId: trade.id,
                    quantity: totalQty,
                    averageCost: avgCost,
                    direction: trade.direction,
                    timestamp: nowISO,
                  }),
                );
              }
            }
          } catch (posErr) {
            // Non-fatal — position creation failure does not block the
            // valuation_mark write or price refresh. Log and continue.
            console.log(
              JSON.stringify({
                event: 'mtm-refresh.position.error',
                tradeId: trade.id,
                instrumentId: instrument.id,
                error: String(posErr),
                timestamp: nowISO,
              }),
            );
          }

          const priceDecimal = String(quote.price);
          const micros = Math.round(quote.price * 1_000_000);
          // Canonicalize the stored price string: market-data quotes can
          // carry 3+ fraction digits (e.g. "11.645") which break strict
          // canonical-decimal consumers (toMicros). priceMicros keeps full
          // precision; price is the display/contract canonical form.
          const canonicalPrice = normalizeDecimal(priceDecimal);

          db.insert(valuationMarks)
            .values({
              id: randomUUID(),
              accountId: trade.accountId,
              instrumentId: instrument.id,
              price: canonicalPrice,
              priceMicros: micros,
              source: 'market_data',
              markTimestamp: nowISO,
              idempotencyKey: `mtm-refresh:${trade.id}:${nowISO}`,
              createdAt: nowISO,
            })
            .run();

          accountsWithNewMarks.add(trade.accountId);

          console.log(
            JSON.stringify({
              event: 'mtm-refresh.valuation-mark',
              tradeId: trade.id,
              instrumentId: instrument.id,
              price: quote.price,
              source: 'market_data',
              timestamp: nowISO,
            }),
          );
        } catch (valuationErr) {
          // Non-fatal — valuation_marks insertion failure does not
          // block the price refresh. Log and continue.
          console.log(
            JSON.stringify({
              event: 'mtm-refresh.valuation-mark.error',
              tradeId: trade.id,
              error: String(valuationErr),
              timestamp: nowISO,
            }),
          );
        }
      } catch {
        failed.push(trade.symbol);
      }
    }

    // Rebuild once per affected account after the batch. This preserves the
    // quote's stored micro precision in account NAV without turning market
    // refresh into one projection rebuild per instrument.
    for (const accountId of accountsWithNewMarks) {
      try {
        const performance = rebuildAccountPerformance(getSqliteHandle(), accountId);
        if (!performance.success) {
          console.log(
            JSON.stringify({
              event: 'mtm-refresh.performance-rebuild.error',
              accountId,
              error: performance.error ?? 'Unknown performance rebuild error',
              timestamp: nowISO,
            }),
          );
        }
      } catch (error) {
        console.log(
          JSON.stringify({
            event: 'mtm-refresh.performance-rebuild.error',
            accountId,
            error: error instanceof Error ? error.message : String(error),
            timestamp: nowISO,
          }),
        );
      }
    }

    // ── Enrich sector/industry from Yahoo profiles ──────────────────────
    // When the primary quote provider (e.g. Schwab) does not return sector or
    // industry metadata, fetch it from Yahoo Finance as a non-blocking enrichment.
    if (updated > 0) {
      const symbolsToEnrich = [...new Set(
        openTrades
          .filter(t => !failed.includes(t.symbol))
          .map(t => t.symbol),
      )];

      try {
        const profiles = await fetchYahooProfiles(symbolsToEnrich);

        let enriched = 0;
        let unchanged = 0;

        for (const trade of openTrades) {
          if (failed.includes(trade.symbol)) continue;
          const profile = profiles.get(trade.symbol.toUpperCase());
          if (!profile?.sector && !profile?.industry) {
            unchanged++;
            continue;
          }

          db.update(positionPriceSnapshots)
            .set({
              sector: profile.sector ?? null,
              industry: profile.industry ?? null,
            })
            .where(
              and(
                eq(positionPriceSnapshots.tradeId, trade.id),
                eq(positionPriceSnapshots.fetchedAt, nowISO),
              ),
            )
            .run();
          enriched++;
        }

        console.log(
          JSON.stringify({
            event: 'mtm-refresh.enrichment',
            enriched,
            unchanged,
            errored: 0,
            total: symbolsToEnrich.length,
            symbols: symbolsToEnrich,
            timestamp: nowISO,
          }),
        );
      } catch (err) {
        // Non-fatal — enrichment failure leaves snapshots as-is.
        console.log(
          JSON.stringify({
            event: 'mtm-refresh.enrichment.error',
            error: String(err),
            symbols: symbolsToEnrich,
            timestamp: nowISO,
          }),
        );
      }
    }

    // ── Update cooldown timer (only on success) ───────────────────
    // The timer resets only when at least one quote was successfully
    // persisted. If all quotes failed, the caller can retry immediately.
    if (updated > 0) {
      markRefreshSucceeded();
    }

    return NextResponse.json({
      updated,
      failed,
      timestamp: nowISO,
    });
  } catch (error) {
    // Provider error before any update — do NOT reset the timer,
    // the caller can retry immediately.
    return NextResponse.json(
      { error: 'Failed to refresh MTM prices', details: String(error) },
      { status: 500 },
    );
  }
}
