# Product

## Register

product

## Users

Active traders who journal their trades to improve performance. They sit down at the end of a trading day or week to log plans, review closed positions, grade their process, track mistakes, and run weekly retrospectives.

Context: focused, analytical, often after a session of active trading. They want fast data entry, clear signal, and zero friction between thought and record. The tool is a personal cockpit — not social, not performative.

## Product Purpose

A local-first trading journal that helps traders track ideas, plans, executions, risk, reviews, account activity, and performance dashboards — all on their own machine. Success means the trader journals consistently, spots patterns in their behavior, and improves their process over time.

## Dashboard Role

The dashboard is the live workstation. Its default first-screen job is to
answer, without browser zoom or configuration: **what is open, what is at
risk, and whether the displayed market state is trustworthy enough to act on.**

Open positions, current risk, unrealized P&L, account state, and material
warnings therefore take precedence over period performance. Performance review
is the second layer: it should be immediately available, but must not displace
live risk from the initial view.

The default workstation is curated and stable. Traders may create or select
saved views to arrange the information for a specific workflow, but layout
editing is an explicit mode rather than the default experience. The dashboard
must not become a blank canvas or a collection of miniature widgets.

Price-derived values earn trust by making their scope and data state legible.
The interface must distinguish a current, complete value from a stale, partial,
or unavailable one; it must not silently make incomplete market data look like
valid P&L.

## Brand Personality

**Sharp, Disciplined, Analytical.** Not warm, not cold — precise. The interface commands respect through clarity and restraint. Every pixel has a job. The trader trusts it because it never surprises them.

Voice: direct, minimal, professional. No metaphor, no personality sign-off. Data labels tell you exactly what you're looking at. Error messages say what broke and what to do next.

## Anti-references

- **Robinhood and gamified trading apps.** No confetti, no celebration animations, no bright saturated primaries, no card-flip reveals. Trading is not a game.
- **Generic SaaS dashboards.** Not another blue-and-white B2B tool with rounded everything. This tool has a specific operator personality.
- **Over-designed "dark trader" aesthetics.** No terminal-green-on-black clichés, no faux Bloomberg density, no chrome reflections.

## Design Principles

1. **Noise is the enemy.** Every visual element earns its place. Typography hierarchy, spacing rhythm, and data density prioritize scanability over decoration. If it doesn't help the trader make a decision faster, remove it.

2. **Color carries meaning.** Green and red communicate P&L direction and risk — functionally, not decoratively. The palette is restrained (one accent color, plus directional red/green) so color always signals, never decorates.

3. **Respect the trader's focus.** Consistent layouts, predictable interactions, no surprises. Forms don't clear on save without confirmation. Tables sort predictably. Filters persist where sensible. The interface gets out of the way.

4. **Progress over performance.** The journal is for learning, not ego. Process grades and mistake tracking are presented plainly — framed as data for improvement, not judgment. Empty states encourage without coddling.

5. **Local-first, trust-first.** The data lives on the trader's machine. The interface should feel equally solid — snappy navigation, instant saves, no spinners where local data suffices.

6. **Current state before retrospective.** The dashboard resolves immediate
   position and risk decisions before it presents historical analysis. A
   number is only actionable when its account, period, and market-data state
   are understandable where it is shown.

## Accessibility & Inclusion

- WCAG 2.1 AA minimum (4.5:1 body text, 3:1 large text).
- Color is never the sole differentiator — P&L values use both color and sign (+/-), status badges use both color and text labels.
- `prefers-reduced-motion` respected: animations are crossfade or instant, never essential for understanding state.
- Tabular data uses proper `<th>` scope and text labels for screen readers.
