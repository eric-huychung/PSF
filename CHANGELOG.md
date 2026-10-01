# Changelog

## Unreleased

### Removed
- CSV bank adapters (Chase, Bank of America, Amex, Robinhood) and their fixtures. PDF statement import, cross-checked against an LLM evidence read, is now the only import path.

## 0.3.0 — 2026-09-30

### Added
- Transaction detail modal showing a larger bank logo and account info.
- Redesigned Settings page: categories and accounts now show representative icons, and Settings can open directly to a given section.
- Redesigned dashboard filters: bank/account pickers are now pill dropdowns (replacing native `<select>`s), plus refreshed chart theming and stat tiles.
- Refreshed favicon.
- Reusable `BankLogo` component shared across the dashboard filters, transactions, and settings.

## 0.2.0 — 2026-09-28

Phase 2 integration release: the PSF foundation is now usable through a complete local-first app flow.

### Added
- First-run setup that connects PSF to a local data folder, restores returning sessions, and blocks unsupported browsers clearly.
- CSV upload with automatic bank detection, manual format selection, parse preview, and categorization progress states.
- Transaction review with confidence indicators and immediate merchant-rule corrections.
- Dashboard charts for spending by category and over time, plus month/year transaction browsing.
- Settings for securely entering the OpenRouter key into the local data folder and managing flat spending categories.
- Responsive glass interface inspired by the reference light and dark designs, including an accessible Sun/Moon theme control.

### Fixed
- Prevented the dashboard from repeatedly reloading its default 12-month range after each render.

## 0.1.0 — 2026-09-28

Phase 1 foundation: local storage, bank CSV import, AI categorization, and the design system. No screens are wired together yet (that's Phase 2) — this release lands the underlying building blocks.

### Added
- Local-folder storage via the File System Access API: pick a folder, read/write months, rules, categories, and settings as JSON files, with explicit errors on lost permission or corrupt files (no silent data loss).
- CSV import for Chase, Bank of America, Amex (basic and detailed), and Robinhood (cash movements only); malformed rows are skipped with a warning instead of crashing the import.
- AI-assisted categorization: a rules cache for instant repeat matches, escalating to Haiku and then Sonnet only when needed, so most transactions never touch the network.
- Light and dark themes with a full component set (cards, buttons, tables, nav, spending charts) built on a shared token system.

### Notes
- Sign-convention handling for Chase/BoA has only been checked against hand-built sample files, not a real downloaded statement — worth a one-time manual check before relying on it.
- Categorization requests to the AI provider aren't throttled yet; fine for normal use, could hit rate limits on a very large one-time import.
