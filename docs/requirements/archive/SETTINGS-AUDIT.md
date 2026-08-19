# Settings Ownership Audit

**Status:** Exploratory findings — no product decisions approved

## Purpose

This audit identifies where the Settings experience duplicates account ownership, exposes values with no user-visible effect, or groups unrelated configuration together. It is intended to guide a future settings-ownership milestone without changing existing data or behavior prematurely.

## Executive Summary

The current Settings hub mixes five different concepts:

1. Workspace-wide preferences.
2. Per-account operational configuration.
3. Global fallback defaults for account configuration.
4. Journal reference data.
5. External integrations and data operations.

The largest sources of confusion are:

- App-level display name and default currency have no meaningful current product use.
- The Risk Settings page combines account-default fallback values, a cross-product default-account choice, and legacy account-value fields.
- Account management is exposed as a Settings card even though accounts have their own workspace and own their currency, risk overrides, commission overrides, and ledger opening cash.
- The Settings hub still includes historical reconciliation/cutover guidance that conflicts with the completed accounting cutover.

A focused settings-ownership milestone is recommended. This is more than visual cleanup because it affects persistent-field ownership, fallback behavior, onboarding/readiness, migration safety, and navigation.

## Current Settings Surface

| Surface | Current role | Assessment |
| --- | --- | --- |
| App Preferences | Display name, timezone, default currency | Contains one useful global setting (timezone) and two values with no current user-facing effect. |
| Risk Settings | Global risk/commission defaults, starting account value, journal start date, default account | Contains valid account fallbacks but also unrelated and legacy values. |
| Accounts | Account creation and account list | Duplicates the dedicated Accounts workspace conceptually. |
| Plays | Trade setup taxonomy | Valid, but better classified as journal reference data. |
| Mistake Types | Trade-review taxonomy | Valid, but better classified as journal reference data. |
| AI | Provider and assessment configuration | Valid integration configuration. |
| Market Data | Provider and connection configuration | Valid integration configuration. |
| Backup | Backup, restore, and scheduling | Valid data-safety operation. |
| Factory Reset | Destructive reset | Correctly belongs in an isolated danger zone. |

## Field-Level Findings

### App Preferences

#### Display Name

- The value currently serves the readiness/onboarding check.
- It is not displayed in the product, reports, exports, or other user-facing workflow.
- A setting that has no observable effect creates false expectations.

**Recommendation:** Remove it as an ongoing preference. Either make it optional onboarding metadata with a visible future purpose, or remove the field and the readiness requirement together.

#### Timezone

- Timezone controls date/time formatting throughout the product.
- It also determines scheduled-backup timing.
- It has a clear global meaning and should not be account-specific.

**Recommendation:** Keep it as the primary Workspace preference.

#### Default Currency

- The value is stored and editable but has no current downstream runtime use.
- Currency that affects trades, balances, risk, and accounting is owned by each account.
- An app-wide currency is misleading in a multi-account or multi-currency journal because it implies reporting conversion behavior that does not exist.

**Recommendation:** Remove it from App Preferences. If a convenience default is wanted, define it narrowly as **New-account default currency** and use it only to prefill account creation; it must not change existing accounts or imply a reporting-currency conversion.

### Risk Settings

#### Global Max Risk Per Trade and Default Commission

- These settings are not technical duplicates of account settings.
- Account-level values override them; the global values are fallbacks when an account has no override.
- The existing page does not make this inheritance model clear, so it reads as duplicated configuration.

**Recommendation:** Keep them, but rename the surface to **Risk Defaults** and explain: “Used only by accounts without an override.” Account settings should show whether each value is inherited or overridden and show the effective value.

#### Default Account

- The setting is actively used by Plan Trade, position sizing, watchlist promotion, dashboard selection, and exports.
- It is not a risk parameter.

**Recommendation:** Move selection to Accounts. The account list should show the default account and offer an explicit “Make default” action. This is the correct home because the user is choosing an account, not configuring a risk rule.

#### Starting Account Value

- This remains a global fallback in some value/risk-snapshot paths.
- It conflicts with the current accounting model, where opening cash belongs in the account ledger.
- Removing it without a migration audit could change historical calculations for accounts that still rely on the fallback.

**Recommendation:** Treat it as legacy compatibility, not as a routine user setting. First identify dependent accounts and migrate safe cases to ledger opening cash. Only then remove the global fallback and its UI.

#### Journal Start Date

- The value is stored and editable but has no current downstream runtime consumer.

**Recommendation:** Remove it as dead configuration after confirming no external or historical workflow depends on the stored value.

## Ownership Model

The future structure should separate configuration by scope rather than presenting one flat collection of cards.

### Workspace

- Timezone.
- Optional workspace/journal name only if it gains a visible purpose.

### Accounts

- Account management.
- Default-account selection.
- Account currency.
- Account-level risk and commission overrides.
- Ledger opening cash and account lifecycle actions.

### Risk Defaults

- Global max-risk-per-trade fallback.
- Global default-commission fallback.
- Explicit inheritance rules and effective-value visibility.

### Journal Setup

- Plays.
- Mistake types.

### Integrations

- AI provider configuration.
- Market-data provider configuration.

### Data and Backups

- Backup creation.
- Scheduled backups.
- Restore and restore safety information.

### Danger Zone

- Factory reset, isolated from ordinary configuration.

## Stale Guidance

The Settings hub still includes reconciliation/cutover and legacy read-only guidance. Accounting projections are now authoritative and reconciliation is historical migration evidence, not an ongoing user workflow.

**Recommendation:** Remove this guidance or replace it with current operational information about accounting corrections, data integrity, and backup/restore safety.

## Recommended Milestone Scope

A settings-ownership milestone should be organized around safe behavior changes rather than a visual redesign alone:

1. **Clarify ownership and navigation**
   - Move default-account selection to Accounts.
   - Remove the Accounts card from the Settings hub or turn it into a clearly labeled route to the Accounts workspace.
   - Group cards into Workspace, Risk Defaults, Journal Setup, Integrations, Data and Backups, and Danger Zone.

2. **Make fallback behavior understandable**
   - Preserve global-to-account risk and commission inheritance.
   - Make inherited versus overridden values explicit in account settings and risk defaults.

3. **Retire unused and legacy configuration safely**
   - Remove or repurpose default currency.
   - Remove display name and journal start date only after changing the readiness and data contracts.
   - Audit and migrate dependencies on global starting account value before removing it.

4. **Remove obsolete accounting language**
   - Replace reconciliation/cutover documentation with current accounting and backup guidance.

## Non-Goals

- Changing the account risk/commission fallback semantics without an explicit product decision.
- Changing account currency automatically.
- Removing legacy starting-account-value data before dependency analysis and migration planning.
- Rebuilding backup/restore behavior as part of the settings redesign.

## Evidence Notes

This audit was based on the current Settings pages, configuration APIs, schema ownership, and downstream consumers. A live browser review was attempted but unavailable because the browser daemon exited during startup.
