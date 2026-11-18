# Agent Contract

This public repository owns DinkusKit Accounts: shopper accounts for
DinkusKit Commerce stores on EmDash. Keep it generic: site copy, customer
data, branding, credentials, and production configuration do not belong
here. Assume every committed byte is public.

## Direction and research

Read the organization [vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [scope and planning](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md)
with [docs/CHARTER.md](docs/CHARTER.md). They describe direction; they do not
establish implemented capabilities. A recommendation is not a decision until
the owner answers it and it is recorded in the GrillTrack ledger.

Use the installed `emdash-commerce` skill for material product or architecture
questions. Research alone does not authorize implementation.

## Running GrillTrack

Run `./scripts/agent-skills` first; it installs the pinned SaariusSkills
skills into ignored `.cursor/skills/`. Use
`./scripts/grilltrack --project . validate` or `show` for ledger reads. Only
the CLI changes `.grilltrack/`; never edit it by hand.

In Claude Code cloud sessions `.claude/hooks/session-start.sh` checks Node
against `.nvmrc` and runs `npm ci`, then reports anything missing; read that
report before running project scripts.

## Boundary

- This repository owns shopper accounts: the shopper record, signing in with
  an emailed 6-digit code, the shopper's session, saved addresses and the
  account pages.
- DinkusKit Commerce remains the sole owner of products, prices, carts,
  checkout, orders and money. Accounts never writes any of them. Shoppers can
  always check out as guests.
- EmDash gives each plugin its own storage and has no plugin-to-plugin calls.
  Accounts cannot read Commerce's orders and Commerce cannot read Accounts'
  shoppers. How "my orders" and the checkout address fill cross that line is
  an open design question (docs/CHARTER.md); do not read another plugin's
  data directly or assume cross-plugin access.
- Shoppers are not EmDash users. Staff sign in to the EmDash admin; shoppers
  sign in to the store through this plugin.
- Admin screens are Block Kit only. No React admin.
- Shopper pages are server pages that work without page script.
- The plugin is Registry-enabled and sandboxed with no native escape. It asks
  for a capability, a network host or a public route only when a recorded
  decision needs one; `scripts/check-registry-bundle.mjs` fails the build
  otherwise.

## Bootstrap state

This is a scaffold. The plugin has one admin page, **Shopper accounts**, that
says shoppers cannot sign in yet. It keeps no data, sends no email, and is not
published. Shopper accounts still live in DinkusKit Commerce until this plugin
replaces them. There is no release workflow or changeset setup yet; each
arrives in its own pull request.

`.github/workflows/clawsweeper-dispatch.yml` sends non-draft pull requests to
`main` for a ClawSweeper review, as in the other DinkusKit repositories. It
does nothing until the repository variable `CLAWSWEEPER_SPARK_ENABLED` is
`true` and the review runner has enrolled this repository.

Run `npm ci --ignore-scripts`, `npm run typecheck` and `npm test` before
pushing. `npm test` builds the plugin, runs the official Registry packaging
with its 128 KiB per-file limit, then runs the tests.

## Gates

Do not publish to npm, list in the EmDash Registry, deploy, merge, or change a
live store without the owner's explicit approval.
