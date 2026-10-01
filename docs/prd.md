# PSF — Product Requirements

## Problem

People who want to track spending across multiple banks either:
- link accounts through a third-party service (Plaid-based apps like Copilot, Monarch) and give up control of their data, or
- self-host an open source tool (Firefly III, Actual Budget) and keep control, but categorization is rule-based — every new merchant needs a manual rule.

PSF pairs "your data never leaves your machine" with an LLM that actually understands the transaction.

**Who it's for:** tech-comfortable people who want a private budgeting tool, are fine bringing their own LLM API key, and don't want their bank data touching a third-party server.

**Success:** drop in this month's statements → most transactions land in the right category automatically → view a clean month/year dashboard with charts → nothing leaves the user's machine except the minimum needed for categorization, sent with their own API key.

## Goals

- Statement in → categorized transactions out, with minimal manual work after the first pass.
- Nothing leaves the user's machine except the transaction text sent to OpenRouter for categorization.
- Zero infra to run: static site, works from a Vercel URL, no backend.

## Non-goals

- Safari/Firefox support or any fallback storage engine.
- Investment/portfolio tracking (Robinhood = cash movements only).
- Subcategories — flat category list only.
- Built-in sync or accounts — cross-device is "sync the folder yourself."
- Bank API linking (Plaid-style).
- Non-OpenRouter LLM providers.

## Feature list

- First-run folder picker; local JSON storage, no server.
- PDF statement import, parsed via a deterministic line-based extractor, cross-checked against an LLM evidence-based read of the same statement for extra confidence.
- Categorization: merchant rules cache → LLM categorizer. Low-confidence results are flagged for review instead of guessed.
- Review screen: confirm/correct categories; corrections persist to the rules cache so the same merchant is never re-guessed.
- Transfers: a category can be marked as an internal transfer (e.g. paying a credit card from checking) and is excluded from spending totals so it isn't double-counted.
- Budgets: optional monthly target per category, shown against actuals on the dashboard.
- Dashboard: spending by category, spending over time, month/year browsing.
- Settings: OpenRouter key entry, category and account management.
- Non-Chromium blocking screen — no degraded mode.

## Risks

- **Bank/statement format drift** — the PDF extractor needs maintenance as banks change statement layouts; ongoing cost, not a one-time spike.
- **Miscategorization** — review/correct UX is load-bearing, not optional polish.
- **Chromium-only** — narrows the audience; no fallback for Safari-only users.
- **Plaintext API key** — `settings.json` holds the OpenRouter key in plaintext on disk, consistent with the local-only threat model (see [`SECURITY.md`](../SECURITY.md)).

See [`system-design.md`](system-design.md) for how this is built.
