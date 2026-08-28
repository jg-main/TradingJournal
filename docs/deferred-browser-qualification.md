# Deferred Browser Qualification

> Status: DEFERRED TEST / RELEASE-INFRASTRUCTURE ISSUES
>
> These are **NOT known economic-correctness defects** in the frozen single-user product. They were isolated from trade/account/economic correctness during M007 and explicitly deferred. See §1 for the scope decision and §5 for reopen triggers.

## 1. Scope decision

- M007 economic correctness was frozen at `fbcdb4cc56fc8a19ea1459a39761d4593f5bdf04`.
- The application is currently targeted at **private single-user Docker/homelab operation**.
- Browser-harness perfection was **explicitly not required** to close M007 because the remaining failures were isolated from trade/account/economic correctness.
- **Full Browser Qualification was waived** as an M007 closure gate.
- The browser matrix is **not** fully green; the items below are the known gaps.

## 2. Known deferred browser/harness issues

### A. Next dev Webpack transport instability

The current Playwright harness starts the application with:

```text
next dev --webpack
```

Large development chunks observed:

- trade page chunk: ~4.1 MB decoded
- layout chunk: ~2.3 MB decoded

Observed serving characteristics and symptoms:

- gzip encoding
- chunked transfer
- repeated navigation/serve instability
- JavaScript parser corruption symptoms

Firefox parser errors observed:

- `literal not terminated`
- `unterminated comment`
- `missing )`

Chromium parser error observed:

- `Invalid or unexpected token`

These broke client hydration and produced false browser-test failures (e.g., a trade-detail page stuck on "Loading trade details...").

### B. Accept-Encoding identity experiment

- Forcing `Accept-Encoding: identity` removed the JavaScript parse-corruption class entirely in the bounded experiment.
- Chromium became stable in the bounded experiment (5/5 lightbox runs green).
- Firefox retained partial-transfer/loading instability with the larger uncompressed chunks (residual failure rate remained non-zero).
- Therefore identity was **NOT committed** as the solution.

### C. Firefox NS_BINDING_ABORTED

Historical dev-harness failures observed in:

- performance-dashboard `shell continuity` navigation (`page.goto → NS_BINDING_ABORTED; maybe frame was detached?`)
- settings.spec navigation

Initially suspected as a separate navigation race. A later production-server A/B proved the same flows are green under `next start`:

- shell-continuity: 8/8 green
- settings: 8/8 green

Therefore the failures are strongly tied to the **development-server/browser lifecycle** rather than proven product navigation defects.

### D. Production server proof

`next build` / `next start` eliminated the transport class in the bounded audit:

- trade-assets-lightbox:
  - Firefox: 10/10 fully green
  - Chromium: 10/10 fully green

Production JS chunks:

- content hashed
- roughly 13–222 KB
- dramatically smaller than dev chunks
- no observed parse/partial-transfer failures in the bounded sample

One production build was successfully reused across multiple fresh `next start` processes with:

- unique ports
- unique `DB_FILE_NAME`
- unique disposable databases

The database path is runtime-resolved (`src/db/index.ts` reads `process.env.DB_FILE_NAME` at startup), not baked at build time.

### E. Why production Playwright migration was not completed

Two blockers:

1. **`/dev/*` fixture routes.** Production `next start` does not expose the dev fixture surfaces used by the workstation/dashboard fixture-mode tests, for example:
   - workstation-live
   - workstation-keynav
   - workstation-arrange
   - workstation-shell
   - workstation-views
   - workstation-responsive
   - dashboard-related dev fixture tests
   - visual-regression fixture surfaces

   (This list is representative, not an exhaustive source inventory.)

2. **Deterministic market data.** `PLAYWRIGHT_MOCK_MARKET_DATA` is intentionally guarded by `NODE_ENV !== 'production'`. This safety guard was **NOT weakened**. Under `next start` the mock remains disabled, so market-data-dependent flows (e.g., workstation-live MTM refresh) can reach the real market-data provider, creating nondeterministic qualification behavior.

**Do NOT enable the current mock in production.**

## 3. Other deferred infrastructure issue

- A historical container-era `next-server` orphan process owned by user 1001 could not be killed by the normal user.
- It held no relevant current port or Next lock.
- It was hygiene debt, **not** an M007 correctness blocker.

## 4. What is NOT deferred

The following were resolved before M007 froze and are **not** part of the deferred browser debt:

- economic execution/accounting correctness
- long/short execution lifecycle
- execution atomicity
- funding
- canonical account scope
- NAV/equity provenance
- A2/A2.1 historical equity
- incomplete NAV safety
- missing-mark short safety
- MTM lifecycle
- reconciliation
- historical rollforwards
- performance metrics
- CT3 chart economic fixtures
- workstation shared-state 429 assumption
- known stale deterministic E2E contracts

## 5. When to reopen this work

Explicit triggers:

- application becomes publicly accessible;
- hosted web deployment;
- multi-user deployment;
- browser compatibility becomes a supported product promise;
- external contributors depend on reproducible full E2E CI;
- automated release pipeline requires Chromium + Firefox qualification;
- immutable browser qualification becomes a release gate.

Private solo-user Docker operation alone is **not** a reason to reopen it.

## 6. Recommended future starting point

If reopened:

1. start from **production-server Playwright qualification** (`next build` / `next start`), not from further tuning `next dev --webpack`;
2. preserve the production mock safety invariant;
3. design a deterministic quote boundary suitable for qualification — e.g., a harness-owned deterministic upstream, or another explicitly test-only external boundary (a mock microservice is one possible architecture, not a mandatory prescription);
4. decide how `/dev` fixture-mode coverage should work:
   - retain a separate dev-only regression partition, or
   - replace with production-compatible fixtures, or
   - retire fixture-only browser coverage where redundant;
5. validate representative specs;
6. then restore immutable Chromium + Firefox Full Browser Qualification.

## 7. Historical reference points

Useful SHAs:

- original immutable FBQ: `bd99ea28cf1fbbda92b7880069e6dd9aa9cb472f`
- performance historical fixture: `bd92f62c53a4427872eab21e83a7d94ff07c0464`
- CT3 correction: `da244463b1f142d38f1fef604f861e3bd4f5bc24`
- workstation shared-sequence correction: `d7c4c046c53a6fde1a6801510836bb646f67eb1a`
- stale deterministic E2E cleanup head: `0a51cefcb791cc3f28c34f9fbe0db7d9a0b96022`
- M007 frozen baseline: `fbcdb4cc56fc8a19ea1459a39761d4593f5bdf04`

Historical workflow runs:

- original FBQ: `33175122123`
- final pre-freeze ordinary gate: `33202671583`
- freeze gate: `33212270676`
