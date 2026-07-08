# ClickHouse Market Database Schema

> **Last updated:** 2026-07-08
> **Database:** `market` (production), `market_development` (development mirror), `market_test` (test sandbox)
> **Data source:** AlgoSeek US Equity data via QuantSift feature engineering pipeline
> **Access:** Native TCP port 9000, HTTP interface port 8123

## Connection

| Property | Value | Configurable |
|----------|-------|-------------|
| Host | `localhost` | `CLICKHOUSE_HOST` env |
| Port (native) | 9000 | - |
| Port (HTTP) | 8123 | `CLICKHOUSE_PORT` env |
| User | `default` | `CLICKHOUSE_USER` env |
| Password | Configurable | `CLICKHOUSE_PASSWORD` env |
| Default database | `market` | `CLICKHOUSE_DATABASE` env |

## Database Overview

Three databases share the same schema:

| Database | Purpose | Data Range | Record Count |
|----------|---------|------------|--------------|
| `market` | Production — stable, append-only | 2007-01-03 to 2026-03-09 | ~43M OHLC rows |
| `market_development` | Development — larger, includes feature-enriched tables | 2007-01-03 to 2026-07-02 | ~72M indicator rows |
| `market_test` | Test — same schema, used for pipeline validation | — | — |

> **Note for S02 client:** Use the `market` database for runtime queries. The `market_development` database has additional feature data (`features_equity_features_daily`, `features_equity_indicators_daily`, `features_market_regime_daily`) that are empty in `market`. The client should prefer `market` for OHLC and `market_development` for pre-computed indicators, or make database configurable.

## Table Reference

### 1. `as_secmaster` — Security Master

**Type:** Reference data. One row per unique security.

| Column | Type | Description |
|--------|------|-------------|
| `secid` | `UInt64` | **Primary key.** AlgoSeek security identifier (used as FK across all tables) |
| `tickers` | `LowCardinality(String)` | Semicolon-delimited list of ticker symbols for this security |
| `tickersstarttoenddate` | `String` | Date ranges for each ticker (encoded as string) |
| `name` | `String` | Semicolon-delimited list of company names |
| `isin` | `String` | International Securities Identification Number |
| `liststatus` | `Nullable(Enum8('A','D','L'))` | A=Announced, D=Delisted, L=Listed |
| `securitydescription` | `LowCardinality(String)` | Instrument type description |
| `primaryexchange` | `String` | Semicolon-delimited list of primary exchanges |
| `sic` | `Nullable(UInt32)` | Standard Industrial Classification code |
| `sector` | `LowCardinality(Nullable(String))` | Sector classification |
| `industry` | `LowCardinality(Nullable(String))` | Industry classification |
| `figi` | `String` | Financial Instrument Global Identifier |
| `sedol` | `String` | SEDOL identifier (deprecated) |
| `source` | `LowCardinality(String)` | Data source (e.g., `algoseek`) |
| `load_ts` | `DateTime` | UTC timestamp when record was loaded |

**Engine:** `MergeTree`, partitioned by `intDiv(secid, 100000)`, ordered by `secid`.
**Row count:** ~28,978 securities.
**Status:** ~14,147 distinct listed tickers (`liststatus = 'L'`).

---

### 2. `as_secmaster_ticker_history` — Ticker History

**Type:** Time-series reference. Each secid may have multiple ticker rows over time (ticker changes, name changes, delistings).

| Column | Type | Description |
|--------|------|-------------|
| `secid` | `UInt64` | AlgoSeek security identifier |
| `ticker` | `LowCardinality(String)` | Ticker symbol active during this period |
| `start_date` | `Date` | First date this ticker was active |
| `end_date` | `Nullable(Date32)` | Last date this ticker was active (NULL if current) |
| `liststatus` | `Nullable(Enum8('A','D','L'))` | Listing status during this period |
| `load_ts` | `DateTime` | UTC timestamp when populated |

**Engine:** `ReplacingMergeTree`.
**Row count:** ~33,784.

---

### 3. `as_secmaster__staging` — Security Master Staging

Identical schema to `as_secmaster`. Used for atomic `EXCHANGE TABLES` workflow during data pipeline runs. Not for runtime queries.

---

### 4. `as_us_equity_ohlc_daily` — US Equity Daily OHLC (Bar Data)

**The primary market data table.** Contains open/high/low/close prices and volume for each US equity security per trading day.

| Column | Type | Description |
|--------|------|-------------|
| `tradedate` | `Date` | Trading date |
| `secid` | `UInt64` | AlgoSeek security identifier |
| `ticker` | `LowCardinality(String)` | Ticker symbol on trade date (denormalized convenience field) |
| `open` / `high` / `low` / `close` | `Float64` | Raw OHLC prices |
| `markethoursvolume` | `Decimal(38,6)` | Volume during regular market hours |
| `markethoursfinravolume` | `Decimal(38,6)` | FINRA-reported volume (market hours) |
| `dailyvolume` | `Decimal(38,6)` | Total daily volume (including pre/post market) |
| `dailyfinravolume` | `Decimal(38,6)` | FINRA-reported total daily volume |
| `markethoursvwap` | `Float64` | VWAP during market hours |
| `dailyvwap` | `Float64` | VWAP for full trading day |
| `openadj` / `highadj` / `lowadj` / `closeadj` | `Float64` | **Adjusted** OHLC prices (split/dividend adjusted) |
| `markethoursvolumeadj` | `Decimal(38,6)` | Adjusted volume during market hours |
| `markethoursfinravolumeadj` | `Decimal(38,6)` | Adjusted FINRA volume (market hours) |
| `dailyvolumeadj` | `Decimal(38,6)` | Adjusted total daily volume |
| `dailyfinravolumeadj` | `Decimal(38,6)` | Adjusted FINRA total daily volume |
| `markethoursvwapadj` | `Float64` | Adjusted VWAP (market hours) |
| `dailyvwapadj` | `Float64` | Adjusted VWAP (full day) |
| `schema_version` | `UInt8` | Schema version: `1` = integer volumes, `2` = fractional volumes |
| `source` | `LowCardinality(String)` | Data source (e.g., `algoseek`) |
| `load_ts` | `DateTime` | UTC timestamp when record was loaded |

**Engine:** `MergeTree`, partitioned by `toYYYYMM(tradedate)`, ordered by `(secid, tradedate)`.
**Row count:** ~43,160,139.
**Date range:** 2007-01-03 to 2026-03-09.
**Index:** Secondary index on `ticker` (`type: set(0), GRANULARITY 4`).

**Usage notes:**
- Use the `adj` columns (`closeadj`, `openadj`, etc.) for analysis — they are split/dividend adjusted.
- The `ticker` column is a convenience field; join via `secid` for correctness.
- For assessment evidence bundles at trade date range, query `WHERE secid = ? AND tradedate BETWEEN ? AND ? ORDER BY tradedate`.

---

### 5. `ohlcv_daily` — Simplified OHLCV

**Type:** Subset of `as_us_equity_ohlc_daily` with only adjusted close and volume.

| Column | Type | Description |
|--------|------|-------------|
| `date` | `Date` | Trading date |
| `secid` | `UInt64` | Security identifier |
| `closeadj` | `Float64` | Adjusted close price |
| `volume` | `Float64` | Volume |

**Row count:** ~43,160,139 (same data as OHLC table, subset of columns).
**Date range:** 2007-01-03 to 2026-03-09.

---

### 6. `features_equity_indicators_daily` — Equity Daily Indicators

**Type:** Pre-computed technical indicators for each security per day. **Only populated in `market_development` (empty in `market`).**

| Column | Type | Description |
|--------|------|-------------|
| `date` | `Date` | Trading date |
| `secid` | `UInt64` | Security identifier |
| `openadj` / `highadj` / `lowadj` / `closeadj` | `Float64` | Adjusted prices |
| `dailyvolumeadj` | `Decimal(38,6)` | Adjusted volume |
| `sma_10` through `sma_200` | `Float64` | Simple moving averages |
| `dist_sma_10` through `dist_sma_200` | `Float64` | Distance to SMA (pct) |
| `log_ret_1d` through `log_ret_12m` | `Float64` | Log returns over various windows |
| `atr_14`, `atr_pct_14` | `Float64` | Average true range |
| `rv_10`, `rv_20`, `rv_60` | `Float64` | Realized volatility (annualized) |
| `range`, `range_pct`, `range_expansion` | `Float64` | Price range metrics |
| `gap_open`, `gap_open_pct`, `gap_vs_atr` | `Float64` | Gap analysis |
| `close_position`, `close_strength` | `Float64` | Buying pressure proxy |
| `rs_spy_*`, `rs_qqq_*` | `Float64` | Relative strength vs SPY/QQQ |
| `rank_ret_3m`, `rank_ret_6m` | `Float64` | Cross-sectional return ranks |
| `rank_dollar_volume`, `rank_volatility` | `Float64` | Cross-sectional volume/vol ranks |
| `shock_flag_large_move`, `shock_persistence_3d` | `UInt8`/`Float64` | Shock detection |
| And ~30 more indicator columns | `Float64` | See full DESCRIBE output |

**Engine:** `ReplacingMergeTree(computed_at)`, partitioned by `toYYYYMM(date)`, ordered by `(date, secid)`.
**Row count:** ~72,196,970 (market_development only).
**Date range:** 2007-01-03 to 2026-07-02 (market_development).
**Latest data:** 2026-07-02.

---

### 7. `features_equity_features_daily` — Equity Composite Features

**Type:** Composite feature vectors for each security per day. **Only populated in `market_development`.**

| Column | Type | Description |
|--------|------|-------------|
| `date` | `Date` | Trading date |
| `secid` | `UInt64` | Security identifier |
| `feature_name` | `String` | Canonical feature identifier |
| `feature_version` | `LowCardinality(String)` | Feature version (e.g., `v1`) |
| `computed_at` | `DateTime64(6, 'UTC')` | Computation timestamp |
| `trend_strength` / `trend_strength_long` | `Float64` | Composite trend metrics |
| `momentum_score` / `momentum_short` | `Float64` | Momentum scores |
| `momentum_acceleration` | `Float64` | 3m - 6m acceleration |
| `breakout_pressure` / `breakout_pressure_long` | `Float64` | Breakout distance normalized |
| `volatility_compression` | `Float64` | rv_10 / rv_60 |
| `atr_expansion_score` | `Float64` | ATR expansion |
| `liquidity_score` / `volume_expansion` / `dollar_liquidity` | `Float64` | Liquidity metrics |
| `relative_strength_spy` / `relative_strength_long` | `Float64` | Relative strength |
| `breakout_quality_score` | `Float64` | Composite breakout quality |
| `trend_alignment_score` | `Float64` | SMA distance average |
| `regime_adj_momentum` | `Float64` | Vol-regime adjusted momentum |
| `opportunity_score` | `Float64` | Composite opportunity score |
| `trend_regime`, `vol_regime`, `risk_regime`, `breadth_regime` | `Enum8` | Market regime classifications |
| `composite_regime` | `Enum8` | 6-state composite regime label |

**Engine:** `ReplacingMergeTree`.
**Row count:** ~43,172,675 (market_development only).
**Feature name:** `equity_features_v1`.

---

### 8. `features_market_aggregates_daily` — Market-Level Aggregates

**Type:** One row per trading day with market-wide metrics. No `secid` — these are aggregate measures.

| Column | Type | Description |
|--------|------|-------------|
| `date` | `Date` | Trading date |
| `computed_at` | `DateTime64(6, 'UTC')` | Computation timestamp |
| `rv_spy_5` / `rv_spy_20` / `rv_spy_60` | `Float64` | SPY realized volatility |
| `rv_qqq_20` | `Float64` | QQQ realized volatility |
| `pct_universe_above_50d` / `pct_universe_above_200d` | `Float64` | Market breadth |
| `advance_decline_ratio` | `Float64` | Advancers/decliners |
| `new_52w_highs_count` / `new_52w_lows_count` | `Nullable(UInt32)` | 52-week extremes |
| `spy_drawdown_pct` / `spy_max_drawdown_252` | `Float64` | SPY drawdown |
| `hyg_lqd_ratio` / `spy_tlt_ratio` / `xlk_xlu_ratio` / `iwm_spy_ratio` / `qqq_spy_ratio` / `gld_spy_ratio` | `Float64` | Cross-asset ratios |
| Ratio slopes (5d / 14d / 21d) | `Float64` | OLS slopes of each ratio |
| Volatility estimators (Parkinson, Garman-Klass, EWMA, upside/downside) | `Nullable(Float64)` | SPY vol estimates |
| `realized_skew_spy_60` / `realized_kurt_spy_60` | `Nullable(Float64)` | Higher moments |
| `mcclellan_osc` / `breadth_thrust_10` | `Nullable(Float64)` | Breadth indicators |
| And ~20 more aggregate columns | | See full DESCRIBE output |

**Engine:** `ReplacingMergeTree(computed_at)`, partitioned by `toYYYYMM(date)`, ordered by `date`.
**Row count:** ~4,506 (market) / ~9,101 (market_development).
**Date range:** 2008-05-06 to 2026-03-09 (market).

---

### 9. `features_market_context_probabilities_daily` — Market Context Model

**Type:** One row per trading day with model-predicted market context probabilities.

| Column | Type | Description |
|--------|------|-------------|
| `date` | `Date` | Trading date |
| `context_name` | `LowCardinality(String)` | Canonical context identifier |
| `model_version` | `LowCardinality(String)` | Immutable model version |
| `model_class` | `LowCardinality(String)` | Model class |
| `feature_family` | `LowCardinality(String)` | Feature family |
| `target_horizon_sessions` | `UInt16` | Training target horizon |
| `p_supportive` | `Float64` | Probability of supportive market context |
| `p_transition` | `Float64` | Probability of transition/choppy context |
| `p_hostile` | `Float64` | Probability of hostile market context |
| `predicted_context` | `LowCardinality(String)` | Argmax context label |
| `confidence` | `Float64` | Max probability |

**Engine:** `ReplacingMergeTree`.
**Row count:** ~4,488.
**Date range:** 2008-05-06 to 2026-03-09.

---

### 10. `features_market_instrument_indicators_daily` — Instrument Indicator Features

**Type:** Pre-computed indicator features for benchmark ETF instruments. Has `secid` column referencing the benchmark ETFs.

| Column Group | Key Columns | Description |
|---|---|---|
| Identity | `date`, `secid` | Trading date + security ID |
| Moving Averages | `sma50`, `sma100`, `sma200` | Simple moving averages |
| Distance Metrics | `distance_sma50`, `distance_sma100`, `distance_sma200` | % distance from SMA |
| SMA Slopes | `sma50_slope_20`, `sma100_slope_20`, `sma200_slope_20` | SMA slopes over 20d |
| Log Returns | `log_rtn_1w` through `log_rtn_12m` | Log returns at various windows |
| Realized Vol | `rv_5`, `rv_20`, `rv_60` | Annualized realized vol |
| Volatility Estimators | `parkinson_vol_20`, `garman_klass_vol_20`, `ewma_vol_20` | OHLC vol estimators |
| Downside/Upside | `downside_rv_20`, `upside_rv_20`, `vol_asymmetry_20` | Semi-volatility |
| Drawdown | `drawdown_pct`, `max_drawdown_252`, `days_under_sma200` | Drawdown metrics |
| Extremes | `days_since_high_52w`, `pc_distance_high_52w`, `distance_high_20d` | Distance to extremes |
| Volume | `volume_z_60` | Volume z-score |

**Engine:** `ReplacingMergeTree`.
**Row count:** ~49,566 (market) / ~100,331 (market_development).
**Date range:** 2008-04-10 to 2026-03-09 (market).

---

### 11. `features_market_regime_daily` — Market Regime Classifications

**Type:** One row per trading day with regime labels. **Only populated in `market_development`.**

| Column | Type | Description |
|--------|------|-------------|
| `date` | `Date` | Trading date |
| `regime_name` | `String` | Canonical identifier |
| `regime_version` | `LowCardinality(String)` | Regime version (e.g., `v1`) |
| `trend_regime` | `Enum8('bull','neutral','bear')` | Trend state |
| `vol_regime` | `Enum8('low','normal','high')` | Volatility state |
| `risk_regime` | `Enum8('risk_on','neutral','risk_off')` | Risk appetite |
| `breadth_regime` | `Enum8('broad','neutral','narrow')` | Breadth state |
| `composite_regime` | `Enum8('strong_bull','bull','sideways','unstable','bear','crisis')` | Market composite |

**Engine:** `ReplacingMergeTree`.
**Row count:** ~4,466 (market_development only).

## Symbol Resolution

The mapping between `trade.symbol` (free-text user input) and the ClickHouse market identifier follows this chain:

```
trade.symbol → as_secmaster_ticker_history.ticker → secid → any data table
```

**Key findings:**
- `secid` (UInt64) is the **primary identifier** across all tables — always join by secid.
- `ticker` in `as_us_equity_ohlc_daily` is a **denormalized convenience field** — safe for direct queries but joining on secid is preferred.
- Most popular trade symbols (AAPL, MSFT, GOOGL, AMZN, TSLA, NVDA, SPY, QQQ) are present as listed `('L')` tickers.
- Some symbols may have multiple `secid` entries (e.g., META has secid 6981246 and 3513095 — the `liststatus` and date range fields disambiguate).
- `as_secmaster_ticker_history.end_date = NULL` indicates the currently active mapping.

**Symbol resolution query:**
```sql
SELECT secid, ticker, start_date, end_date
FROM market.as_secmaster_ticker_history
WHERE ticker = 'AAPL'
  AND liststatus = 'L'
ORDER BY start_date DESC
LIMIT 1;
```

## Query Patterns for Trade Quality Assessment

### 1. Get OHLC data for a symbol around a trade date range

```sql
SELECT
    tradedate,
    ticker,
    openadj,
    highadj,
    lowadj,
    closeadj,
    dailyvolumeadj,
    dailyvwapadj
FROM market.as_us_equity_ohlc_daily
WHERE secid = (
    SELECT secid
    FROM market.as_secmaster_ticker_history
    WHERE ticker = 'AAPL' AND liststatus = 'L'
    ORDER BY start_date DESC LIMIT 1
)
  AND tradedate BETWEEN '2026-01-15' AND '2026-02-15'
ORDER BY tradedate;
```

### 2. Get market-wide context for a date

```sql
SELECT
    date,
    rv_spy_20,
    pct_universe_above_50d,
    pct_universe_above_200d,
    advance_decline_ratio,
    new_highs_minus_lows,
    mcclellan_osc,
    iwm_spy_ratio,
    gld_spy_ratio
FROM market.features_market_aggregates_daily
WHERE date BETWEEN '2026-01-15' AND '2026-02-15'
ORDER BY date;
```

### 3. Get market context probabilities (model predictions)

```sql
SELECT
    date,
    p_supportive,
    p_transition,
    p_hostile,
    confidence,
    predicted_context
FROM market.features_market_context_probabilities_daily
WHERE date = '2026-02-01';
```

### 4. Get pre-computed indicators for a security (development database)

```sql
SELECT
    date,
    sma_20, sma_50,
    dist_sma_20, dist_sma_50,
    atr_pct_14,
    rv_20,
    log_ret_1m, log_ret_3m,
    close_position,
    rs_spy_3m
FROM market_development.features_equity_indicators_daily
WHERE secid = 33449  -- AAPL
  AND date BETWEEN '2026-01-15' AND '2026-02-15'
ORDER BY date;
```

### 5. Get regime context (development database)

```sql
SELECT
    date,
    trend_regime,
    vol_regime,
    risk_regime,
    composite_regime
FROM market_development.features_market_regime_daily
WHERE date = '2026-02-01';
```

## Key Considerations for S02 Client Design

### Schema Differences Between Databases

| Table | `market` | `market_development` |
|-------|----------|----------------------|
| `as_us_equity_ohlc_daily` | ✅ 43M rows | ✅ 44M rows |
| `features_equity_indicators_daily` | Empty (0 rows) | ✅ 72M rows |
| `features_equity_features_daily` | Empty (0 rows) | ✅ 43M rows |
| `features_market_regime_daily` | Empty (0 rows) | ✅ 4K rows |
| `features_market_aggregates_daily` | ✅ 4.5K rows | ✅ 9K rows |

**Recommendation:** Make database name configurable so the client can query `market_development` for indicator data during development/assessment context enrichment, while defaulting to `market` for base OHLC queries.

### Table Engine Semantics

- **`MergeTree`** tables (`as_us_equity_ohlc_daily`, `as_secmaster`) are append-only — no deduplication needed.
- **`ReplacingMergeTree`** tables (`features_*`) may have duplicate rows with different `computed_at` timestamps. Always use `ORDER BY + LIMIT 1 BY` or `argMax()` patterns to get the latest version:
  ```sql
  SELECT DISTINCT ON (date, secid) *
  FROM market_development.features_equity_indicators_daily
  ORDER BY date, secid, computed_at DESC;
  ```

### Data Freshness

| Database | Latest OHLC Date | Latest Indicators Date |
|----------|------------------|----------------------|
| `market` | 2026-03-09 | N/A (no indicators) |
| `market_development` | 2026-07-02 | 2026-07-02 |

The `market` database is frozen at 2026-03-09. `market_development` is actively updated as of 2026-07-02.

### Security Identifiers

- `secid` is a stable integer identifier from AlgoSeek that persists across ticker changes and corporate actions.
- `figi` and `isin` are additional identifiers available in `as_secmaster` for cross-referencing.
- The `as_secmaster_ticker_history` table handles ticker changes over time — some securities had different tickers at different dates.

### Data Source

All data is sourced from **AlgoSeek** (`source = 'algoseek'`), a provider of historical US equity market data. The feature engineering pipeline is built by **QuantSift**.
