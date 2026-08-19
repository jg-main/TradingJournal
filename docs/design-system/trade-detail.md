# Trade Detail Surface

**Part of the TradingJournal Design System** (see [`README.md`](./README.md)).

**Status:** stub. This file carries the trade-detail grid contract at a
summary level; the detailed `td-` pattern documentation (grid layout, panel
structure, review sections) is expanded in a later milestone slice.

**Authoritative source:** `src/components/trade-detail/trade-detail-grid.css` —
`.td` scoped custom properties and grid patterns, plus the trade-detail
components under `src/components/trade-detail/`.

## Trade-detail grid contract

The trade detail page is a dense, lifecycle-first grid scoped under `.td`:

- **No competing scrollbars.** The trade detail page scrolls at the document
  level; the legacy shell's `<main>` owns the scrollbar and no panel creates
  an inner scrollbar.
- **Named panel areas.** The grid defines lifecycle, cockpit, details, risk,
  context, history, review, and assets areas. The lifecycle stepper spans the
  top; three continuous columns follow: Cockpit → Context, Trade Details →
  History, and Risk → Review; Assets span the first two columns beneath
  Context and History.
- **Variant grids.** A `.td-grid--planned` arrangement covers planned trades
  (lifecycle band + plan panel, pre-trade screenshots in the Assets row); a
  `.td-grid--closed` arrangement freezes the snapshot for closed trades.
- **Density and type.** Rows meet the same 36–40px readability contract as the
  workstation; decision labels/table headers ≥12px, data cells ≥13px, primary
  financial values 16–20px, tabular numerals.
