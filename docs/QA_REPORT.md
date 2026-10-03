# QA report — final verification

Date: 2026-10-03. Author: worker-crm-qa. HEAD at start: `1bc1953`. bun 1.3.12, Node 22.22.0.

## Summary

- Every build check passes: install, Prisma generate and validate, types, Biome lint, oxlint.
- `knip` fails. Most findings are upstream. 24 findings are new unused exports in the SMS code.
- A real Postgres server cannot start in this sandbox. PGlite (Postgres 17 compiled to WASM) runs in process.
- All 61 migrations apply in order on PGlite. The migrated schema matches `schema.prisma`.
- With PGlite, the integration suites run. Two upstream tests failed for real. I fixed both.
- A new end-to-end test covers the core loop. It passes, 7 of 7.
- The secrets scan finds no committed keys, tokens or `.env` files.

## Commits from this job

| Commit | Change |
| --- | --- |
| `15ae1e0` | `packages/telemetry/src/allowlist.ts`: add the 7 SMS agent tools to `AGENT_TOOLS`. `allowlist.spec.ts` failed on HEAD. |
| `5e4d684` | `apps/agent/test/keyless-brand.integration.spec.ts`: set `FEATURE_ENRICHMENT=true` for the keyed case. The P0 flag made it fail. |
| `b1ff0b2` | `apps/api/test/core-loop.integration.spec.ts`: the end-to-end test. |

## Build checks

Env: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/crm` (dummy).

| Command | Result |
| --- | --- |
| `bun install` | pass |
| `bun run db:generate` | pass |
| `prisma validate` (packages/db) | pass |
| `bun run check-types -- --force` | pass, 13/13 (no turbo cache) |
| `bun run lint -- --force` | pass, 9/9 (no turbo cache) |
| `bun run lint:slop` (oxlint) | pass |
| `bun run lint:dead` (knip) | **fail**. Upstream findings plus 24 new unused exports (see Issues). |

## Unit and integration tests

Two runs per package. Run A has no database: `TEST_DATABASE_URL` points at `127.0.0.1:1`.
Run B uses the PGlite preload described below. Counts are after the fixes in this job.

| Package | Run A (no DB) | Run B (PGlite) |
| --- | --- | --- |
| apps/agent | 383 pass, 95 fail (all DB unreachable) | **547 pass, 0 fail** |
| apps/api | 367 pass, 58 fail, 7 errors (DB unreachable, port bind) | **588 pass, 0 fail** (2 files left out, see below) |
| apps/app | 187 pass | 187 pass |
| packages/auth | 34 pass, 7 fail (DB unreachable) | **51 pass, 0 fail** |
| packages/db | 115 pass | 115 pass |
| packages/env | 22 pass | 22 pass |
| packages/telemetry | 44 pass, 17 fail | **60 pass, 1 fail** (needs a shared server, see below) |
| packages/validation | 54 pass | 54 pass |
| packages/ui | no test script | — |

Not run, because the sandbox forbids it:

- `apps/api/test/auth.e2e.spec.ts` and `tracking-collector.spec.ts` listen on a port. The sandbox refuses `listen` (EPERM). The unhandled error also stops `sms-telnyx-webhook.spec.ts` mid-file in a full run. That file passes alone, 16 of 16.
- `packages/telemetry/test/install.integration.spec.ts` "two separate processes" spawns child processes. They cannot share an in-process PGlite.

## Database

### Why PGlite

- No `docker`, `postgres`, `pg_ctl` or `psql` exists on the machine.
- `embedded-postgres` installs, but `initdb` fails: `shmget ... Operation not permitted`. The sandbox blocks System V shared memory.
- `@electric-sql/pglite-socket` cannot serve the wire protocol: TCP and Unix socket `listen` both fail with EPERM.
- So PGlite 0.5.8 runs inside the test process. `pglite-prisma-adapter` 0.7.2 connects the generated Prisma client to it.

### How to repeat run B

Install outside the repo: `npm i @electric-sql/pglite pglite-prisma-adapter` in a scratch folder. Then preload this file with `bun test --preload <file>`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "<scratch>/node_modules/@electric-sql/pglite/dist/index.js";
import { PrismaPGlite } from "<scratch>/node_modules/pglite-prisma-adapter/dist/index.mjs";
import { PrismaClient } from "<repo>/packages/db/src/generated/prisma/client";

const dir = "<repo>/packages/db/prisma/migrations";
const pg = await PGlite.create();
for (const m of readdirSync(dir).filter((d) => /^\d/.test(d)).sort()) {
	await pg.exec(readFileSync(`${dir}/${m}/migration.sql`, "utf8"));
}
globalThis.prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) });
```

`@crm/db` reuses `globalThis.prisma`, so every test gets the PGlite client. `TEST_DATABASE_URL` must still name a `*_test` database.
With a real Postgres, run `bun run db:test` and the suites as normal. No preload is needed.

### Migrations

- All 61 migration folders apply in order, from the upstream ones through `20261003140000`, `150000`, `153000`, `160000`. The uncommitted `20261003170000_consent_phone_retention` from another temp also applies.
- `contact_phone_e164_check` exists with `convalidated = false`, as the `NOT VALID` clause intends.
- Drift check: one database from the migrations, one from `prisma migrate diff --from-empty --to-schema`. Columns, indexes, enums and functions match exactly. The only extra objects are two hand-written CHECK constraints, which Prisma cannot express: `contact_phone_e164_check` and the upstream `agentBuilderArtifact` check.
- `prisma migrate deploy` itself did not run. It needs a server connection. The `_prisma_migrations` table and Prisma's transaction wrapping are not tested.

## End-to-end test — `apps/api/test/core-loop.integration.spec.ts`

Real code: `LeadImportService`, `LeadWriterService`, `FirstTouchService`, the send gate, consent and suppression services, `SmsSender`, `SmsInternalService`, `TelnyxWebhookController`, `SmsService`, `KeywordService`, `CalendarInternalService`, `CalendarWriteClient`, the agent's `claimDue`, `runLiveSmsTask`, `finishSmsTurns`, and the tools `classify_reply`, `record_qualification`, `propose_slots`, `send_sms`, `book_meeting`.

Fakes:

- Telnyx: `TelnyxClient` gets a fetch that records each message.
- Google: `CalendarWriteClient` gets a fetch that answers free/busy (all free) and event insert.
- The agent → API bridge: `fetch` is replaced. Calls to `API_URL` go straight to `SmsInternalService.send` and `CalendarInternalService.handle`. The bearer header is checked. The controllers' body reading and auth are not in this path; their own specs cover them.
- The model: a script calls the real tools with a session context built from the pipeline's `turn.auth`.
- `focusOn` is replaced with a no-op. It writes eve per-session state and throws outside an eve runtime.
- The clock is pinned with `setSystemTime`: import at 2026-10-06 03:00Z, which is night in Texas.

| Step | What the test proves |
| --- | --- |
| Import | A CSV with one consented row and one row without consent creates 1 contact and rejects 1. The rejected number has no contact. |
| First touch | One `first-touch` task exists. `dueAt` equals `nextSendWindow(importTime)`, which is later than the import. Nothing is due or sent at import time. |
| Send window | At `dueAt` the task runs without a model, Telnyx gets one text with "STOP", and the task finishes. |
| Inbound | A webhook signed with a generated Ed25519 key is stored and queues an `sms-reply` task. |
| Qualify | The scripted turn classifies, records the five facts, gets ≥ 2 slots and texts the offer. The deal is `QUALIFIED_TO_BUY`. |
| Book | A second inbound, then `book_meeting` with the lead's email. Google gets the event with the attendee. A `CalendarEvent` row exists at the offered start. The deal is `DEMO_BOOKED`. A confirmation text goes to the lead. |
| STOP | `PhoneSuppression` exists and the opt-out confirmation goes out. The API then blocks a conversation text (`suppressed`). A later inbound runs a turn, and `send_sms` answers `refused`. No more texts go out. |
| No consent | A contact without a `ConsentRecord` is blocked (`no-consent`). Neither no-consent number ever receives a text. |

Without a database this file fails like every other `*.integration.spec.ts` file.

## Secrets scan

- Tracked files: only `.env.example` matches an env file name. `.env` is in `.gitignore`.
- Tree and full history (`git log --all -p`): no Anthropic, OpenAI, AWS, Google API, Google OAuth, Slack, GitHub, Telnyx (`KEY0…`), webhook-secret or private-key patterns.
- `.env.example` has empty values for every secret. The only hits are placeholder URLs in docs and in `.agents/skills`.

## Issues

1. RISK — After STOP, a new inbound still starts a model turn. Model credits are spent on a suppressed lead.
   Fix: not done. Settle `sms-reply` tasks in `planSmsTask` (`apps/agent/agent/lib/sms-pipeline.ts:102`) when the number is in `PhoneSuppression`.
2. RISK — `SmsInternalService` replays a stored receipt for a repeated idempotency key without comparing contact or text. A reused key reports "sent" for a text that never went out.
   Seen in a QA run: a context without `callId` gave key `send_sms:undefined`, and the second text got the first text's receipt.
   Fix: not done. Store the contact and a body hash with the claim (`apps/api/src/sms/sms-internal.service.ts:104`), and refuse a mismatch.
3. RISK — Migration `20261003140000` fails on an existing database where two active contacts share a phone after normalisation. The deploy stops.
   Fix: documented in the SQL comment. Merge or archive duplicates before the deploy.
4. BROKEN — `knip` fails. 24 findings are new unused exports in the SMS code, for example `apps/api/src/google/calendar-write.slots.ts:64` `zonedParts` and `apps/api/src/sms/keywords.ts:7` `normaliseKeyword`.
   Fix: not done. Remove the `export` keywords or use the symbols. The upstream findings remain as before.
5. BROKEN — `packages/telemetry` `allowlist.spec.ts` failed: 7 SMS tools were not in `AGENT_TOOLS`. Their telemetry counted as `other`.
   Fix: done in `15ae1e0`.
6. BROKEN — `apps/agent` `keyless-brand.integration.spec.ts` failed: `FEATURE_ENRICHMENT` is off by default since P0.
   Fix: done in `5e4d684`. The test now turns the flag on for the keyed case.
7. UNKNOWN — `prisma migrate deploy` did not run. The sandbox blocks a Postgres server.
   Fix: run `bun run db:deploy` against a real Postgres before release.
8. UNKNOWN — `auth.e2e.spec.ts`, `tracking-collector.spec.ts` and the telemetry two-process test did not run. The sandbox blocks `listen`.
   Fix: run `bun run test` with a real Postgres outside the sandbox.
9. UNKNOWN — The Nest app did not boot, and the UI did not render. `next build` cannot reach Google Fonts here.
   Fix: boot `bun run dev` with a real Postgres and click through the inbox, import and drafts pages.
10. NOT DONE — The end-to-end test calls the bridge services, not the HTTP controllers. It stubs `focusOn`. It does not run `eve` or a real model.
    Fix: not done. Needs an eve test harness or a staging run with `eve eval`.
