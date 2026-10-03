# Build status — P0 (tasks 1–2)

Date: 2026-10-03. Built by worker-crm-p0-fork2 against bun 1.3.12, Node 22.22.0.
Plan: `../RESEARCH.md` section 4.

## Commits

1. `Import upstream trycompai/crm v1.15.3` — upstream tree as downloaded (no `.git`), `bun.lock` kept.
2. `P0 task 1` — product renamed to Insurance SMS CRM (root package `insurance-sms-crm`, README with
   attribution to trycompai/crm, MIT `LICENSE` unchanged). New `@crm/env/features` with
   `FEATURE_ENRICHMENT`, `FEATURE_SLACK`, `FEATURE_TRACKING` (off unless `"true"`), gating
   Context.dev/LinkedIn/Perplexity in the agent, Slack credentials in `@crm/auth`, and the public
   tracking endpoints. Nothing deleted.
3. `P0 task 2` — Prisma: `SmsMessage`, `ConsentRecord`, `PhoneSuppression`, enums `SmsDirection`,
   `SmsStatus`, `ConsentSource`, `SuppressionReason`; `RecordSource.LEAD_IMPORT`, `ActivityType.SMS`;
   `Contact.phone` partial unique index `contact_phone_active_key` (where `archivedAt` is null) and
   an E.164 CHECK. Migration `packages/db/prisma/migrations/20261003140000_sms_consent_suppression`.
   Contact create/update now normalise phone to E.164 (`@crm/validation/phone` `toE164`).

## Commands and results

Env used: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crm` (dummy; no database runs).

| Command | Result |
|---|---|
| `bun install` | pass (Prisma engines need `binaries.prisma.sh` reachable) |
| `bun run db:generate` (`prisma generate`) | pass |
| `bunx prisma validate` / `prisma format` | pass |
| `bun run check-types` | pass, 13/13 tasks |
| `bun run lint` (biome per package) | pass, 9/9 tasks |
| `bun run lint:slop` (`oxlint`) | pass |
| `bun test` in `packages/validation` | pass, 8 tests (incl. new `phone.spec.ts`) |
| `bun run lint:dead` (`knip`) | **fails, pre-existing**: same findings on the untouched upstream import (unused deps/exports in upstream). No new findings from P0. |

## Not run

- `bun run test` / agent and api specs: upstream tests are integration tests that require
  `TEST_DATABASE_URL` (a throwaway Postgres, `bun run db:test`). No database is available to the
  build agent. `apps/agent/test/capabilities.spec.ts` was updated for the enrichment flag but not run.
- `prisma migrate deploy` against a real database. The migration was produced with
  `prisma migrate diff --from-schema <previous schema> --to-schema prisma/schema.prisma --script`,
  plus hand-written phone normalisation and the CHECK constraint.

## Notes for later phases

- Migration behaviour: existing phones are normalised to E.164 (bare 10-digit = +1). Rows that cannot
  be normalised are kept; the CHECK is `NOT VALID`, so they cannot be saved again until fixed. If two
  active contacts share a number after normalisation, the unique index fails and names it.
- `Company.phone` is untouched (not texted).
- `toE164` assumes North America for numbers without `+`; P2 import may swap in `libphonenumber-js`.
