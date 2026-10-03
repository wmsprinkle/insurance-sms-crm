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

# Build status — P3 tasks 10–11 (worker-crm-p3a-agent)

Date: 2026-10-03. bun 1.3.12.

## What exists

- `apps/agent/agent/hooks/outbound-guard.ts` — port of `guard.py` and the `llm.py` output rules.
  Exports `detectInjection`, `breaksCharacter(message, disclosure)`, `stripContactInfo`,
  `guardOutbound({ message, bookingLink, disclosure })` (verdict `pass | sanitized | fallback`),
  `OUTBOUND_GUARD` (480-char cap, 16-message history, 400 chars per message, `SAFE_FALLBACK`),
  `DISCLOSURE_MODES`, `outboundSmsInput`. eve hooks are observe-only, so the default hook only logs
  when the model asks `send_sms` for a body that breaks character or exceeds the cap.
  **Enforcement is `guardOutbound`, which the `send_sms` tool (task 12) must call before sending.**
- Changes from the Python version: `\bDAN\b` is case-sensitive (the name "Dan" no longer reads as an
  injection); curly apostrophes are matched; the vendor-name alternation is grouped; digits inside
  the kept booking link are no longer stripped as a phone number; the cap counts characters, not
  UTF-16 units; in `disclose` mode an honest "I'm an automated assistant" passes (the old guard
  replaced it with the fallback, so disclose mode never worked).
- Skills (flat markdown, load on demand): `sms-conduct` (rules 1–13, disclosure modes),
  `qualification` (classify enum, opt-out in free text, "no" is not a refusal, fields, disqualifiers,
  deal-stage mapping), `compliance`, and knowledge templates `knowledge-agency`,
  `knowledge-term-life`, `knowledge-health-insurance` (ported from the old `knowledge/*`).
- To customise knowledge: edit or add `apps/agent/agent/skills/knowledge-<product>.md` with a
  `description:` line starting "Use when a lead asks about…". Keep all knowledge bodies under 9000
  characters (tested). No prices, guarantees, URLs, emails or phone numbers (tested). Set the
  licensed states in `knowledge-agency.md`.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/outbound-guard.spec.ts test/sms-skills.spec.ts` (apps/agent) | pass, 80 tests |
| `bun run check-types` (apps/agent) | pass |
| `bun run lint` (apps/agent, biome) | pass; 1 pre-existing warning in `agent/lib/tasks.ts` |
| `bun run lint:slop` (root oxlint) | no findings in P3 files; fails on other temps' files in `apps/api` |

## Needs from later tasks

- Task 12 `send_sms`: call `guardOutbound` and send `verdict.message`; take the input as
  `outboundSmsInput` (`{ body }`) or change both together. Tool names the skills use: `send_sms`,
  `classify_reply`, `opt_out_contact`, `handoff_to_human`, `record_qualification`, `propose_slots`.
- Task 13 pipeline: run `detectInjection` on inbound text; put `Disclosure mode: disclose|deflect`
  and the booking link (when any) in the task message; cap history with `OUTBOUND_GUARD`.
- `classify_reply` enum and qualification field values belong in `packages/validation` (not in
  P3a scope); they must match `qualification.md`, which `test/sms-skills.spec.ts` checks.
- Task 20: the disclosure-mode setting. Default is `disclose`.

# Build status — P4a (tasks 16–17, Google calendar booking)

Date: 2026-10-03. Built by worker-crm-p4a-calendar against bun 1.3.12.

## Task 16 — scopes and re-consent (`packages/auth/src/scopes.ts`)

- New `CALENDAR_EVENTS_SCOPE` (`calendar.events`), `CALENDAR_FREEBUSY_SCOPE` (`calendar.freebusy`),
  `BOOKING_SCOPES`, `READ_SYNC_SCOPES` (Gmail + `calendar.readonly`).
- `SYNC_SCOPES` = read scopes + booking scopes. Sign-in (`auth.ts`), `/grant-access` and the
  Connections "Connect Google" button all request `SYNC_SCOPES`, so every new grant includes booking.
- `SYNC_SCOPES_FOR.google` (used by `hasSyncScopes` and the mailbox wall) stays on the read scopes.
  An account granted before the upgrade keeps syncing and is not walled.
- Re-consent helpers: `missingBookingScopes(scope)`, `hasBookingScopes(scope)`,
  `needsBookingGrant(accounts)`. They are exported from `@crm/auth/scopes` only (the `@crm/auth`
  barrel was out of scope). Re-consent itself is the upstream `linkSocial` call with `SYNC_SCOPES`.

## Task 17 — `apps/api/src/google/calendar-write.*`

- `calendar-write.client.ts` — `CalendarWriteClient(tokens, fetcher)`:
  `freeBusy`, `availableSlots`, `insertEvent`, `bookSlot` (re-queries free/busy right before
  insert; returns `slot-taken` and does not insert on overlap). Insert uses
  `sendUpdates=all&conferenceDataVersion=1` with a `hangoutsMeet` create request; optional
  client `eventId` makes retries return `duplicate` (HTTP 409). Token via `MailboxTokenService`
  (`grantedScopes` → `needs-reconsent` before any Google call; `accessTokenFor(userId, "calendar")`
  refreshes). All HTTP goes through the injected `CalendarFetch`.
- `calendar-write.slots.ts` — pure, timezone-aware (Intl only, DST-safe) `generateSlots` returns
  2–3 options, one per business day first, then fills from the earliest free slots.
- `calendar-write.config.ts` — `CALENDAR_WRITE` (business hours Mon–Fri 09:00–17:00, 30 min slots,
  2 h lead, 7 day horizon, timeouts, backoff).
- `calendar-write.contracts.ts` — zod schemas for the free/busy and event responses and the booking
  input; result union `CalendarWriteResult`.
- `calendar-write.module.ts` — `CalendarWriteModule` provides `CALENDAR_FETCH` and the client.
  **Not imported into `AppModule`/`GoogleModule` yet** (out of scope). Task 18 imports it.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/booking-scopes.spec.ts test/mailbox-grant.spec.ts` (auth) | pass, 26 |
| `bun test calendar-write-slots/client, mailbox-scopes, mailbox-api-client` (api) | pass, 55 |
| `bun run check-types` (auth) | pass |
| `bun run check-types` (api) | no errors in calendar-write files; errors in other temps' uncommitted `src/leads/*` |
| `bun run lint` (auth) | pass (1 pre-existing barrel warning) |
| `biome check` on calendar-write files (api) | pass; package lint fails only on other temps' uncommitted files |

## Not done here

- UI prompt for re-consent (`needsBookingGrant` in `apps/app/lib/session.ts` or the Connections page),
  and the Connections copy that still says "Read-only Gmail and Calendar".
- Agent tools `propose_slots` / `book_meeting` (task 18), `CalendarEvent` row, Deal stage move.

# Build status — P2 tasks 7–8 (worker-crm-p2-leads)

Date: 2026-10-03. Code in `apps/api/src/leads/`. Task 9 (first-touch enqueue) is not built.

## Task 7 — CSV import (`leads.importPreview`, `leads.importCommit`)

- `csv.ts` parses RFC 4180 CSV (quotes, `""`, CRLF, BOM, newlines in quotes). Row numbers are the
  record numbers in the file, so the report points at the right line.
- `lead-csv.ts`: `suggestMapping(headers)` guesses columns from common names; `leadColumnMapping`
  requires `phone`, `consentSource`, `consentCapturedAt` and `optInText` or `optInUrl`.
- `lead-validation.ts` `checkLead`: phone through `@crm/validation/phone` `toE164` (no new
  dependency), consent source must be a `ConsentSource` value (case and `-`/space tolerant), consent
  date must parse and not be in the future, opt-in URL must be http(s). Every failed rule is a code
  in `LEAD_REJECTIONS`; a row gets all of its codes.
- `lead-batch.ts` `triage`: dedupe against active contacts by phone, then by email (email is
  unique), then inside the batch. Statuses: `ready`, `created`, `duplicate`, `rejected`.
- `LeadWriterService` creates `Contact` (`source = LEAD_IMPORT`) plus a nested `ConsentRecord` in one
  transaction per row through `AgentTriggerService.withCrmEvents`, which emits `contact.created`. A
  unique violation at write time becomes `duplicate`, not an error. Existing contacts are never
  changed and never get a new consent row.
- Preview with no mapping returns the suggested mapping and `mappingIssues`, and writes nothing.
- Caps (`leads-config.ts`): 5 MiB CSV, 5,000 rows, 100 columns.

## Task 8 — `POST /leads/ingest`

- Anonymous Nest controller, one lead per request, raw body read with a 32 KiB cap (413 above it).
- Per-source HMAC: `LEAD_INGEST_SECRETS="<source>:<secret>,…"` (declared in `env.validation.ts`,
  documented in `.env.example`). Headers `x-lead-source`, `x-lead-timestamp` (unix seconds, ±5 min),
  `x-lead-signature` = `sha256=` + hex HMAC-SHA256 of `<timestamp>.<raw body>`; compared with
  `timingSafeEqual`.
- Unset or malformed secrets: endpoint answers 503 and logs; the API still boots.
- Body parsed with zod `leadIngestBody` (`phone`, names, `email`, `consent{source, capturedAt,
  optInText, optInUrl, ip}`), then the same `checkLead` + dedupe + writer as the CSV path.
- Answers: 200 `{status: "created" | "duplicate", contactId, reasons}`; 422 `{status: "rejected",
  reasons}`; 400 bad JSON/shape; 401 bad source/signature/timestamp.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/lead-import.spec.ts test/lead-ingest.spec.ts` (apps/api) | pass, 27 tests |
| `bun run check-types` (apps/api, `tsc --noEmit`) | pass |
| `bun run lint` (apps/api, biome) | pass; 4 warnings, all in files P2 did not touch |
| `oxlint` on `src/leads` and the two specs | pass |
| `nestjs-trpc generate` into a temp dir | pass; the only change is the new `leads` router |

## Not done / needs from others

- `apps/api/src/generated/server.ts` is not regenerated (outside P2 scope). Run
  `bun run trpc:generate` in `apps/api` after merging, or the app cannot call `leads.*`.
- No integration test against Postgres (no `TEST_DATABASE_URL`). The writer and the controller
  have no test that runs a real insert or a real HTTP request.
- `toE164` does not check that an area code exists. libphonenumber-js would catch more bad numbers.
- Task 9: each created lead must enqueue a first-touch `AgentTask`; `LeadWriterService.writeOne` is
  the place.

# Build status — P1 tasks 3–6 (worker-crm-p1-sms)

Date: 2026-10-03. SMS plumbing, DRY_RUN by default. Plan: `../RESEARCH.md` §2.1–2.4, §4 P1.

## Task 3 — `TelnyxClient` (`apps/api/src/sms/telnyx.client.ts`)

- `send({ to, text, from? })` → `{ id, from, dryRun }`. Rejects a recipient that is not E.164.
- Dry run returns `dryrun-<uuid>` and never calls Telnyx. Dry run is on unless `DRY_RUN="false"`
  **and** `TELNYX_API_KEY` is set (`@crm/env/sms` `readSmsEnv`).
- Per-sending-number token bucket (`rate-limiter.ts`), `TELNYX_MPS` (default 1, burst 1).
- Env: `DRY_RUN`, `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_FROM_NUMBER`,
  `TELNYX_PUBLIC_KEY`, `TELNYX_MPS` — all optional, in `.env.example` and `env.validation.ts`.
- Tunables in `apps/api/src/sms/sms-config.ts` (`SMS`).

## Task 4 — `POST /webhooks/telnyx` (`telnyx-webhook.controller.ts`)

- Anonymous. Reads the raw body (256 KiB cap → 413), verifies Ed25519 over `{timestamp}|{raw body}`
  with `TELNYX_PUBLIC_KEY` (base64, raw 32 bytes), ±300 s replay window → 401. No key → 503.
  Not a Telnyx event → 400.
- `message.received`: sender normalised to E.164, matched to an active contact, `SmsMessage`
  inserted (unique `telnyxId` → retries answer `duplicate`), and an `AgentTask` kind `sms-reply`
  queued in the same transaction. A second message folds into the not-yet-started task.
  Payload shape: `@crm/validation/sms-reply-task` (`{ type: "sms.received", smsMessageIds, from }`).
- `message.sent` / `message.finalized`: status from `to[0].status`; a status never moves backwards.
- Work per request is one lookup plus one transaction; no model call.

## Task 5 — send gate (`apps/api/src/compliance/*`, `sms/sms-sender.service.ts`)

- `SendGateService.check({ to, contactId, purpose, state? })`. Order: keyword reply → allowed;
  `PhoneSuppression` → blocked; no un-revoked `ConsentRecord` → blocked; outside quiet hours →
  blocked with `retryAt` (next allowed instant, 15-min steps, 8-day horizon).
- Quiet hours: federal 8:00–21:00 plus a per-state table (`compliance-config.ts`). State comes from
  a declared state, else the area code (`area-codes.ts`). Split-time-zone states must be in window
  in every zone. Unknown state → every US zone and every state rule at once (strictest).
- Every decision writes an `AgentEvent` (`sessionId` `compliance:send-gate`, type
  `sms.send.allowed` / `sms.send.blocked`, data: to, purpose, reason, retryAt, state, timezones).
  The audit write happens before the send; a failed audit write fails the send.
- `SmsSender.send` = gate → `TelnyxClient` → `SmsMessage` OUTBOUND (dry run `SENT`, live `SENDING`,
  refused `SENDING_FAILED` with the Telnyx code).

## Task 6 — keyword fast path (`sms/keywords.ts`, `sms/keyword.service.ts`)

- Whole-message match only (case, spaces, quotes and end punctuation ignored). Sentences such as
  "please stop texting me" go to the agent's classifier (task 12).
- STOP set (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT, OPT-OUT, REVOKE): suppress the
  number (`STOP_KEYWORD`), revoke consent, finish open `sms-reply` / `first-touch` / `sms-follow-up`
  tasks with outcome `opted-out`, one confirmation. Works for unknown numbers too.
- START / UNSTOP: lift only `STOP_KEYWORD` / `OPT_OUT_REQUEST` suppressions, add a `SMS_KEYWORD`
  consent. HELP / INFO: reply only. No `sms-reply` task for any keyword.
- Replies use the workspace name; text lives in `SMS.keywordReplies`.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/sms-*.spec.ts test/compliance-*.spec.ts` (apps/api, `TEST_DATABASE_URL` pointed at an unreachable `*_test` URL so nothing connects) | pass, 69 tests |
| `bun test` in `packages/env` | pass, 22 tests (5 new) |
| `bun run check-types` in `apps/api`, `packages/env`, `packages/validation` | pass |
| `bun run lint` (biome) in `apps/api`, `packages/env`, `packages/validation` | pass (4 warnings, none in P1 files) |
| `oxlint` on P1 files | pass |

## Not run / not done

- No database: services are tested against an in-memory fake (`test/support/sms-db.ts`), not Postgres.
- Nest boot with `SmsModule` wired was not run (needs `DATABASE_URL` and a live app).
- Quiet-hour state rules and the area-code table are unverified [A]; they need a legal check.
  State holidays are not modelled.
- Inbound from a number no contact has: keywords are honoured, other text is logged and dropped.
- No `SMS` `Activity` row on the timeline yet (P5 task 19).

# Build status — P2b (task 9, integration, P1 keyword gap) (worker-crm-p2b-firsttouch)

Date: 2026-10-03. bun 1.3.12.

## Task 9 — first touch (`apps/api/src/leads/first-touch*.ts`)

- `LeadWriterService` calls `FirstTouchService.enqueue(tx, …)` inside the same transaction that
  creates the contact and its consent row. A failed enqueue rolls back the lead.
- `planFirstTouch` order: task already exists → `already-queued`; `PhoneSuppression` → `suppressed`;
  no un-revoked `ConsentRecord` → `no-consent`; no window in the 8-day horizon → `no-send-window`.
  Otherwise one `AgentTask` kind `first-touch`, `dueAt` = `nextSendWindow(now, sendWindowFor(phone))`.
- Idempotent per contact: advisory lock `agent-task:first-touch:<contactId>`, then any existing
  `first-touch` task (finished or not) blocks a second one.
- Message text: `AppSetting.sms.firstMessageTemplate` (P5 `@crm/validation/sms-settings`, default
  names the agency, the insurance quote request, and STOP). Rendered at enqueue time with the
  contact's first name and the workspace name (fallback `LEADS.firstTouch.agencyFallback`).
  A queued task keeps the text it was queued with. An unreadable `sms` setting throws.
- Payload: `@crm/validation/first-touch-task` `{ type: "lead.created", to, message, origin }`,
  parse with `parseFirstTouchTaskPayload`. Tunables in `LEADS.firstTouch`.
- No Prisma change: the setting reuses P5's `AppSetting.sms` column.

## Integration

- `apps/api/src/generated/server.ts` regenerated twice (P2 `leads` router, then P5 `sms` router and
  settings). Every contracts file it imports is committed.
- oxlint fixes: `calendar-write.client.ts` (`id: booking.eventId`, same JSON output),
  `calendar-write-client.spec.ts` (named `FakeFetch` type, no `typeof`).
- `CalendarWriteModule` imported into `AppModule`.

## P1 gap — keyword retry from an unknown number

- `KeywordService` writes an `AgentEvent` with id `sms-keyword:<telnyxId>` (session `sms:keyword`,
  type `sms.keyword.received`) when no contact owns the sender. A Telnyx retry hits the primary key,
  answers `duplicate`, and sends no second reply. Known contacts still dedupe on `SmsMessage.telnyxId`.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/lead-*.spec.ts test/sms-*.spec.ts test/calendar-write-client.spec.ts` (apps/api, unreachable `TEST_DATABASE_URL`) | pass (37 lead, 48 sms, 17 calendar) |
| `bun test` (packages/validation) | pass, 19 |
| `bun run check-types` (root, turbo) | pass, 13/13 |
| `bun run lint:slop` (root oxlint) | pass |
| `bun run lint` (root, turbo) | fails only on `packages/validation/src/sms-send.ts` (another temp, uncommitted, formatting) |

## Not run / not done

- No Postgres: the enqueue is tested against the in-memory fake, not a real transaction or lock.
- Nest boot with `CalendarWriteModule` and `ComplianceModule` in `LeadsModule` was not run.
- The agent does not yet handle `first-touch` tasks (P3b: send `payload.message` through `send_sms`).

# Build status — P2c agent send endpoint (worker-crm-p2c-sendendpoint)

Date: 2026-10-03. `POST /internal/sms/send`, the agent → API bridge. Contract: `@crm/validation/sms-send` (P3b).

- Controller `apps/api/src/sms/sms-internal.controller.ts`. No anonymous access: `AGENT_BRIDGE_SECRET`
  unset → 503; missing or wrong `Bearer` → 401 before the body is read; bad body → 400; body over
  `SMS_INTERNAL.body.maxBytes` → 413. Constant-time compare (`timingSafeEqual`, same as the agent's
  `channels/crm.ts`).
- `SmsInternalService` (`sms-internal.service.ts`): checks the number is the phone of a live contact,
  claims the idempotency key, sends through `SmsSender` (gate → Telnyx → `SmsMessage`), answers
  `sent` / `blocked` (reason + `retryAt` ISO for quiet hours) / `failed`.
- Idempotency: `AgentEvent` id `sms-send:<idempotencyKey>`, session `sms:send`. Type `sms.send.sent`
  holds the response; a repeat key replays it and sends nothing. A block, a Telnyx failure or a throw
  marks it `sms.send.released`, so a later retry with the same key sends. A held claim answers
  `failed` "in progress".
- `dryRun: true` uses a second `SmsSender` (`SMS_DRY_RUN_SENDER`) whose `TelnyxClient` is forced dry.
  The env variable `DRY_RUN` (any value but `false`, or no Telnyx key) still forces dry for every request.
  No `SMS_DRY_RUN` variable exists.
- Purpose → gate: `opt-out-confirmation` → `keyword-reply` (skips consent and suppression); the rest
  → `conversation`.

| Command | Result |
| --- | --- |
| `bun test test/sms-*.spec.ts test/compliance-*.spec.ts test/lead-*.spec.ts` (apps/api, unreachable `TEST_DATABASE_URL`) | pass, 136 tests (21 new in `sms-internal.spec.ts`) |
| `bun run check-types` (apps/api) | pass |
| `bun run lint` (apps/api) | pass (4 old warnings in other files) |
| `oxlint` on the touched files | pass |

Notes:
- `test/sms-service.spec.ts` keyword-receipt test expected no `emittedAt`; fixed (it failed on HEAD).
- The test fake `agentEvent` gained `findUnique`, `update`, `updateMany`.
- Quiet-hours `retryAt` is tested on the mapping only; the gate reads the wall clock.

# Build status — P5a tasks 19–20 UI (worker-crm-p5a-ui)

Date: 2026-10-03. bun 1.3.12. Commits 45983e4, 680d36f, 5e23f90, c54326e.

## Shared SMS settings (read by P2b and P3b)

- Stored in one additive column `AppSetting.sms` (`Json?`, row `SETTINGS_ID`). Keys
  `sms.firstMessageTemplate`, `sms.disclosureMode` (`disclose` | `deflect`, default `disclose`),
  `sms.autoSend` (default `false` = drafts).
- Shape and parser: `@crm/validation/sms-settings` (`parseSmsSettings`, `DEFAULT_SMS_SETTINGS`,
  `renderFirstMessage` with tokens `{firstName}` and `{agency}`). The first message must contain STOP.
- Migration `20261003150000_sms_settings_handled` also adds `SmsMessage.handledAt`.

## Task 19 — Conversations

- tRPC `sms.threadList` (list input + `filter: open | all`, returns `rows`, `total`,
  `facetCounts.filter`), `sms.thread` (last 200 messages, consent and suppression flags),
  `sms.markHandled` (sets `handledAt` on unhandled inbound messages). Code in
  `apps/api/src/sms/sms.router.ts`, `sms-threads.*`. "Open" = an inbound message with no `handledAt`.
- App: `/[slug]/inbox` (thread list + thread, URL keys `conversation` and `show`), a "Texts" tab on
  the contact record (`components/crm/sms-thread.tsx`), Inbox in the icon rail.
- No composer: a rep cannot type a text from the UI. Sending stays with the agent.

## Task 20 — Import and Compliance

- `/[slug]/contacts/import`: upload, column mapping (suggested by `leads.importPreview`), preview
  with per-row reasons (problems first, 200 rows shown), commit with `leads.importCommit`.
- `/[slug]/settings/compliance`: first message, disclosure mode, auto-send switch
  (`settings.sms`, `settings.setSms`); read-only quiet-hours table (`settings.quietHours`, built from
  `COMPLIANCE.quietHours`); drafts queue is a placeholder card.
- Connections: Google copy no longer says read-only; `needsBookingGrant` on the Connections page shows
  a "Grant calendar access" prompt that re-runs `linkSocial` with `SYNC_SCOPES`.
- `lib/agent-transcript.ts`: verbs for the P3b tools (`send_sms`, `classify_reply`,
  `opt_out_contact`, `handoff_to_human`, `record_qualification`); the app test failed without them.

## Commands and results

| Command | Result |
|---|---|
| `bun run check-types` (root, turbo) | pass, 13/13 |
| `bun run lint` (root, turbo, biome) | pass, 9/9 |
| `oxlint` on every P5a file | pass |
| `bun test` new specs: validation `sms-settings` (8), api `sms-threads` + `quiet-hours-table` (11), app `sms-presentation` + `lead-import` (10) | pass |
| `bun test` in `apps/app` | 173 pass; `workspace-label.spec.ts` needs `TEST_DATABASE_URL` (pre-existing) |

## Not run

- `next build` / `next dev`: the sandbox cannot reach `fonts.googleapis.com`, so the build stops at
  `next/font`. No page was rendered. Client components import only `@crm/ui`, tRPC, React,
  `@crm/auth/client`, `@crm/auth/scopes` and the zod-only `@crm/validation/sms-settings`.
- No Postgres: the thread service, settings writes and `prisma migrate deploy` are untested against
  a database.

# Build status — P3b tasks 12–15 (worker-crm-p3b-agent)

Date: 2026-10-03. bun 1.3.12. Agent side of the SMS conversation. Plan: `../RESEARCH.md` §2.6, §3, §4 P3.

## Task 12 — tools (`apps/agent/agent/tools/`)

- `send_sms({ body })` → `lib/sms-delivery.ts` `deliver()`: contact + phone check → open handoff refuses →
  `guardOutbound({ message, bookingLink, disclosure })` → approval hold → bridge send → result
  `sent | drafted (reason, retryAt) | refused`. Input stays `outboundSmsInput`, so the observe hook still sees it.
- Bridge: `lib/sms-outbound.ts` POSTs `{API_URL}/internal/sms/send` with `Bearer AGENT_BRIDGE_SECRET`.
  Contract `@crm/validation/sms-send` (request has `dryRun`, purposes `conversation | first-touch |
  handoff | opt-out-confirmation`). Unset env, network error or non-2xx → `unavailable` → draft
  `no-send-path`. An unreadable 2xx body throws (it may have been sent). Endpoint: apps/api 223a3d9.
- DRY_RUN: the agent sends `dryRun = DRY_RUN !== "false"`; the API forces a dry run when it is true.
- `classify_reply({ label, quote? })`: enum `@crm/validation/sms-qualification` `SMS_REPLY_CLASSES`
  (skill order). Returns the next action. `qualified` is re-checked against stored facts; missing
  facts downgrade it to `interested`. `not_interested`, `opt_out`, `wrong_number` move linked open
  deals to `UNQUALIFIED_TO_BUY`. Works outside an SMS session without writes (evals use that).
- `opt_out_contact({ reason: opt_out | wrong_number })`: `PhoneSuppression` (`OPT_OUT_REQUEST` /
  `WRONG_NUMBER`), revokes consent, finishes open SMS tasks (`opted-out`), deal → `UNQUALIFIED_TO_BUY`,
  then one confirmation with purpose `opt-out-confirmation` (gate treats it like a keyword reply).
- `handoff_to_human({ reason })`: `lib/sms-handoff.ts`. Opens an `SmsHandoff` row, finishes other SMS
  tasks (`handed-off`), sends `SMS_AGENT.messages.handoff` once. While the row has no `resolvedAt`,
  every send except handoff/opt-out text is refused and new replies settle without a model.
- `record_qualification({ line?, state?, ageBand?, coverage?, timeline?, underAge? })`: creates the
  five CONTACT custom fields on first use (`sms_line_of_insurance`, `sms_state`, `sms_age_band`,
  `sms_coverage_wanted`, `sms_timeline`), writes through `lib/fields.ts` `writeField`, reads back,
  `judgeQualification` → qualified: deal `QUALIFIED_TO_BUY`; rejected (under 18, unlicensed state):
  `UNQUALIFIED_TO_BUY`.
- SMS tools act only on the session's own contact (`lib/sms-session.ts` reads `taskKind`,
  `contactId`, `taskId`, `disclosure` from session auth attributes). The model cannot pick a number.
- Prisma (additive, migration `20261003153000_sms_drafts_handoffs`): `SmsDraft` (+ enum
  `SmsDraftStatus PENDING|APPROVED|DISCARDED`), `SmsHandoff` (one row per contact). Back-relations
  `Contact.smsDrafts`, `Contact.smsHandoff`.

## Task 13 — pipeline (`lib/sms-pipeline.ts`, `lib/sms-runtime.ts`)

- `runResearchLane` diverts kinds `sms-reply` and `first-touch` to `runSmsTask` (no `markRunning`,
  so the contact never shows *Researching*).
- `first-touch`: no model. Sends `payload.message` through `deliver()` (guard + gate + approval).
  Blocked by quiet hours → the task is rescheduled to `retryAt`. Other outcomes close the task.
- `sms-reply`, in order: an earlier turn still running → defer 30 s → open handoff → settle →
  budget (inbound > 12 in the last hour, or > 20 in total; port of `_over_budget`) → handoff →
  `detectInjection` on the new inbound text → handoff → model turn.
- Model turn: one eve session per contact, token `sms:<contactId>` (`crm:sms:<id>` after eve's
  namespace). Message has the lead's words fenced as untrusted, the last 16 lines (400 chars each),
  `Disclosure mode: disclose|deflect` from settings, and the booking link line (none yet, task 18).
- Wiring (approved by god): `lib/dispatch.ts` (start callback takes an optional SMS turn),
  `channels/crm.ts` (dispatch route, `receive` target `smsContactId`, `closeSmsTurn` on
  `session.waiting`, `session.completed`, `turn.failed`, `turn.cancelled`), `schedules/dispatch.ts`
  (same 2 lines for the cron path).
- Tunables: `lib/sms-config.ts` `SMS_AGENT`.

## Task 14 — approval mode (`lib/approval-sms.ts`)

- Setting: `AppSetting.sms.autoSend` (`@crm/validation/sms-settings`, default off). Off → every
  model or first-touch text becomes an `SmsDraft` with reason `approval-mode`. Handoff and opt-out
  confirmations never wait.
- Other holds: `quiet-hours` (with `retryAt`), `send-failed`, `no-send-path`. Labels in
  `SMS_HOLD_REASON_LABELS`; the tool result says why and tells the model not to resend.
- Not `AgentAction`: that table requires an `AgentDefinition` + `AgentRun` (team agents). Not eve
  HITL approval: it parks an unattended session. A row a rep can approve is the queue P5b reads.

## Task 15 — evals and tests

- `apps/agent/evals/sms/replies.eval.ts` (12 cases in `evals/sms/cases.ts`): opt-out phrasing,
  "no problem, tell me more" not cold, quote and advice requests (no price in the reply),
  qualification facts, under-18 rejection, claim → handoff, wrong number. Skips without an AI
  Gateway credential.
- Unit tests: `test/sms-delivery.spec.ts`, `sms-pipeline.spec.ts`, `sms-qualification.spec.ts`,
  `sms-evals.spec.ts` (injection table never reaches the model; free-text opt-out reaches the
  classifier); `packages/validation/test/sms-send.spec.ts`, `sms-qualification.spec.ts`.

## Commands and results

| Command | Result |
|---|---|
| `bun test test/sms-*.spec.ts test/drain.spec.ts` (apps/agent, `TEST_DATABASE_URL` unreachable `*_test`) | pass, 93 tests |
| `bun test test/outbound-guard.spec.ts test/crm-token.spec.ts test/channel-auth.spec.ts` (apps/agent) | pass |
| `bun test` (packages/validation) | pass, 37 tests |
| `bun run check-types` (apps/agent, packages/validation, packages/db, apps/api) | pass |
| `bun run lint` (apps/agent, packages/validation) | pass; 1 pre-existing warning in `agent/lib/tasks.ts` |
| `bun run lint:slop` (root oxlint) | pass |
| `prisma validate`, `prisma generate` | pass |

## Not run

- `eve eval` (spends model credits; no credential). The eval cases run outside an SMS session, so
  the side-effect tools answer "not an SMS session"; the assertions check the calls and inputs.
- No Postgres: `lib/sms-store.ts` (Prisma) has no integration test; logic is tested against a fake.
- `prisma migrate deploy` of `20261003153000_sms_drafts_handoffs`.

# Build status — P5b task 20 remainder, drafts queue (worker-crm-p5b-drafts)

Date: 2026-10-03. bun 1.3.12. Commits 48d4eb8 (API + guard), c230ee1 (UI).

## API — tRPC router `smsDrafts` (`apps/api/src/sms/drafts.*`)

- `queue` — pending `SmsDraft` rows (oldest first, cap `SMS_DRAFTS.list`) with contact name, phone,
  reason, reason label (`SMS_HOLD_REASON_LABELS`), `retryAt`, `handedOff`; plus open `SmsHandoff` rows.
- `approve({ draftId, text? })` — sends through `SmsInternalService.send` (contact check → idempotency
  → `SmsSender` → send gate → Telnyx). Key `sms-draft:<draftId>`: new, not the agent's key; a repeat
  replays, a block releases it for a later retry. Edited text (differs from the stored body) runs the
  guard first; an unedited body was already guarded by the agent. Sent → `APPROVED`, `body`,
  `decidedAt`, `decidedById`. Blocked → draft stays `PENDING`; quiet hours also update `reason` and
  `retryAt`. Not pending → `failed` "no longer pending".
- `discard({ draftId })` — `PENDING` → `DISCARDED` with `decidedAt`/`decidedById`.
- `handBack({ contactId })` — sets `SmsHandoff.resolvedAt`, then queues an `sms-reply` `AgentTask`
  with the inbound messages since the handoff (advisory lock `agent-task:sms-reply:<contactId>`,
  folds into an unstarted task). No inbound since the handoff → resolved, no task.
- `compose({ contactId, text, idempotencyKey })` — manual rep text: guard → same send path, key
  `sms-compose:<client uuid>`.
- Result union `smsSendOutcome`: `sent` | `blocked` (reason, `retryAt`) | `guarded` (reason,
  `suggestion`) | `failed`. The guard never rewrites a rep's text silently: it returns a suggestion.
- Guard: pure copy of the agent's `guardOutbound` in `@crm/validation/outbound-guard` (no eve).
  Booking link is `null`, so a rep-edited link is stripped (returned as a suggestion).
- `SmsModule` registers `SmsDraftsService` and `SmsDraftsRouter`. `server.ts` regenerated (only the
  `smsDrafts` router changed).

## App

- `/[slug]/inbox/drafts`: drafts (editable text, approve / send edited, discard, reset, guard
  suggestion, quiet-hours retry time) and handoffs ("Hand back to agent"). "Drafts" button on the
  Inbox header. Compliance settings card now shows counts and links to the queue.
- `SmsComposer` under every SMS thread (Inbox and contact Texts tab). Disabled with a reason when the
  contact has no phone, opted out, or has no consent. Cmd/Ctrl+Enter sends.
- Presentation: `lib/sms-drafts.ts` (`smsOutcomeNotice`, `smsTextProblem`),
  `lib/sms-presentation.ts` `smsComposerBlock`.

## Commands and results

| Command | Result |
|---|---|
| `bun run test test/sms-drafts.spec.ts` (apps/api, unreachable `TEST_DATABASE_URL`) | pass, 18 |
| `bun test` (packages/validation) | pass, 54 (7 new guard tests) |
| `bun test lib/sms-drafts.test.ts lib/sms-presentation.test.ts` (apps/app) | pass, 12 |
| `bun test` (apps/app) | 182 pass, 1 fail: `workspace-label.spec.ts` needs `TEST_DATABASE_URL` (pre-existing) |
| `bun run check-types` (root, turbo, after `next typegen`) | pass, 13/13 |
| `bun run lint` in apps/api, apps/app, packages/validation | pass (old warnings only) |
| `oxlint` on every P5b file | pass |
| root `bun run lint` / `lint:slop` | fail only on uncommitted P4b files in `apps/agent` |

## Not run / not done

- No page was rendered: `next build` cannot reach `fonts.googleapis.com` in the sandbox.
- No Postgres: the service is tested against an in-test fake, not real transactions or locks.
- `apps/agent/agent/hooks/outbound-guard.ts` still has its own copy of the guard. Switch it to
  `@crm/validation/outbound-guard` so the two cannot drift.
- No icon-rail entry for the drafts page (shared navigation was out of scope).

# Build status — P4b task 18 booking + P3b fixes (worker-crm-p4b-booking)

Date: 2026-10-03. bun 1.3.12. Plan: `../RESEARCH.md` §2.7, §4 P4.

## Bridge (`apps/api/src/google/calendar-internal.*`)

- `POST /internal/calendar/book`, contract `@crm/validation/calendar-book`. Same guard as the SMS bridge:
  no `AGENT_BRIDGE_SECRET` → 503, wrong bearer → 401 before the body is read, bad body → 400, > 32 KiB → 413.
- `action: "availableSlots"` `{contactId, phone, state}` → `slots` `{ownerUserId, timeZone, slots[]}`.
  `action: "book"` `{…lead, start, end, summary, description, attendee | null, requestId, eventId}` →
  `booked` `{ownerUserId, timeZone, organizerEmail, eventId, iCalUID, htmlLink, meetUrl, duplicate}` |
  `slot-taken` `{timeZone, slots[]}` (fresh offers) | `unavailable` `{reason, detail, retryable}`.
- Lead time zone: `sendWindowFor({ e164, state }).timezones[0]` (declared state, else area code, else the
  compliance "unknown" zone). Business hours (`CALENDAR_WRITE.businessHours`) apply in the lead's zone;
  `book` refuses a time outside them (`invalid-input`). `bookSlot` rechecks free/busy before the insert.
- Calendar owner: `AppSetting.calendar.ownerUserId`, else the user of the oldest Google `Account` row.
  Round-robin across reps is NOT built: the extension point is `CalendarInternalService.ownerUserId()`.
- Wired as a controller in `CalendarWriteModule` (already in `AppModule`); `CALENDAR_CLOCK` provider for tests.

## Settings (additive schema change)

- `AppSetting.calendar Json?`, migration `20261003160000_calendar_settings`. Shape and parser:
  `@crm/validation/calendar-settings` (`ownerUserId`, `fallbackBookingLink` http(s) URL, both nullable).
  No UI edits it yet.

## Agent

- `lib/sms-deal.ts` `ensureLeadDeal(contactId, stage)`: in one transaction with an advisory lock
  `sms-deal:<contactId>`. No open deal and stage `QUALIFIED_TO_BUY`/`DEMO_BOOKED` → creates a Deal linked by
  `DealContact` (role `lead`), owner = contact owner → calendar owner → first Google user → first user,
  company = contact company or a new "<name> (household)" company linked to the contact; emits
  `deal.created`. Open deals move forward only (`SMS_AGENT.deals.progress`; a booked deal never drops back
  to qualified) or to a closed stage; each move writes a `STAGE_CHANGE` activity and emits
  `deal.stage.changed` (+ `deal.closed`) as `agent-event` tasks, same payload as the API.
  `prismaSmsStore.setDealStage` now calls it, so `record_qualification` and `classify_reply` create deals.
- `propose_slots()` → 2–3 slots labelled in the lead's zone ("Tue, Oct 6 at 10:00 AM CDT"). Sends nothing.
- `book_meeting({ start, email?, emailDeclined? })`: no email and not declined → `needs-email`; a new email
  is saved on the contact when it has none; declined → event on the owner's calendar only (no attendee).
  Event id = sha256(contactId|start) hex, so a retry hits Google's 409 and counts as booked. On `booked`:
  `CalendarEvent` + `CalendarAttendee` + `MEETING` activity upserted, deal → `DEMO_BOOKED`, confirmation SMS
  through `deliver()` (guard, gate, approval) with idempotency key `book_meeting:<eventId>`.
- Calendar unavailable → the tool's `next` says: send `calendar.fallbackBookingLink`, or `handoff_to_human`.
- `planSmsTask` puts the fallback link in the turn message and the `bookingLink` session attribute (so the
  guard keeps it). `apps/agent/turbo.json` passes `API_URL` and `DRY_RUN`.
- Skills: `qualification.md` "Booking the call"; `sms-conduct.md` rule 6 (link only when the calendar is
  unavailable). Evals: `evals/sms/booking.eval.ts` (4 cases). `apps/app/lib/agent-transcript.ts` verbs
  for the two tools (approved by god).

## Commands and results

| Command | Result |
|---|---|
| `bun run check-types` (root) | pass, 13/13 |
| `bun run lint` (root) | pass, 9/9 |
| `bun run lint:slop` (root) | pass |
| `bun test` apps/agent `sms-*`, `drain`, `outbound-guard` | pass, 187 |
| `bun test` apps/api `calendar-*`, `sms-*`, `compliance-*` | pass, 164 |
| `bun test` packages/validation | pass, 54 |
| `bun test test/agent-transcript.spec.ts` (apps/app) | pass, 45 |
| `prisma validate`, `prisma generate` | pass |

## Not run / not done

- No Postgres: `ensureLeadDeal`, `prismaBookingStore` and the owner query are tested through fakes only.
  `prisma migrate deploy` of `20261003160000_calendar_settings` not run.
- `eve eval` not run (spends credits). Outside an SMS session the tools answer "not an SMS session", so the
  evals assert the calls and inputs, not the booking.
- No real Google call. Duplicate (409) bookings return no Meet link (no `events.get`).
- The confirmation SMS obeys approval mode: with auto-send off it becomes a draft after the event exists.
- No settings UI for `calendar.ownerUserId` / `calendar.fallbackBookingLink`.

# Build status — operator docs (worker-crm-docs)

Date: 2026-10-03. Docs only; no code changed.

- `docs/SMS_SETUP.md` (setup), `docs/OPERATIONS.md` (daily use), `docs/TOLLFREE_VERIFICATION.md`
  (task 21 packet), `docs/sample-leads.csv`, README section "Insurance SMS CRM".
- The setup doc is `SMS_SETUP.md`, not `SETUP.md`: upstream `docs/setup.md` exists, and on a
  case-insensitive file system (macOS default) `SETUP.md` is the same file.
- Every env var was checked against `.env.example`, `apps/api/src/config/env.validation.ts`,
  `packages/env/src/sms.ts`, `apps/agent/agent/lib/sms-outbound.ts` and `apps/agent/turbo.json`.
  P2c's note "`SMS_DRY_RUN=true` in env" means `DRY_RUN`; no `SMS_DRY_RUN` variable exists
  (`SMS_DRY_RUN_SENDER` is a Nest provider token).
- `docs/sample-leads.csv` was run through `parseCsv` → `suggestMapping` → `resolveMapping` →
  `checkRows` → `triage` in a throwaway bun test: 4 rows, 4 `ready`, 0 rejected. The test was
  not committed (outside docs scope).

Not run: the local run steps in `SMS_SETUP.md` §3 (no Postgres, no browser), the SQL in
`OPERATIONS.md` (no database), any Telnyx or Google console step.

# Final QA (worker-crm-qa)

Date: 2026-10-03. Full results, the PGlite method and the issue list: `docs/QA_REPORT.md`.

- Build checks pass (types and lint forced, no turbo cache). `knip` fails: upstream findings plus 24 new unused exports.
- No Postgres server can start in the sandbox. PGlite in process runs every migration in order and the integration suites:
  agent 547/547, api 588/588 (2 port-binding files left out), auth 51/51, telemetry 60/61.
- Fixes: `15ae1e0` (SMS tools in the telemetry allowlist), `5e4d684` (keyless-brand test and `FEATURE_ENRICHMENT`).
- New: `apps/api/test/core-loop.integration.spec.ts` (`b1ff0b2`), import → first touch → signed inbound → qualify → book → STOP → no consent.
- Not run: `prisma migrate deploy`, the Nest boot, the UI, `eve eval`.

# Security fixes — agent side (worker-crm-fix-agent)

Date: 2026-10-03. bun 1.3.12. Findings from `docs/COMPLIANCE_SECURITY_REVIEW.md`.

| Finding | Status | Change |
|---|---|---|
| C1 | fixed | `agent/tools/sms_lockdown.ts` (eve dynamic tools). In a session with `taskKind` `sms-reply`, `first-touch` or `sms-follow-up`, every tool in `SMS_AGENT.tools.locked` is replaced by a stub that refuses and logs. eve 0.29.4 cannot remove a tool per session, so the model still sees the names. Allowed: `SMS_AGENT.tools.allowed`. `purposeOf` returns `sms` for these sessions, so `assertResearchPurpose` tools also refuse. SMS sessions get short SMS instructions instead of the research preamble. |
| H1 (agent) | fixed | `classify_reply` with `opt_out` or `wrong_number` opts the lead out itself (`lib/sms-opt-out.ts` `optOutLead`). |
| H2 (agent) | fixed | `planSmsTask` settles an `sms-reply` without a model when the number is suppressed or has no un-revoked consent for that phone (`store.sendBlock`). The opt-out confirmation goes out only when this call created the suppression, with key `opt-out:<e164>:<suppression createdAt ms>` (the API contract). |
| H5 (agent) | fixed | Every agent draft stores its send key in `SmsDraft.idempotencyKey` (column from fix-api migration `20261003170000`). A bridge timeout is `unknown`, drafted as `send-failed` with the key. Bridge timeout 45 s. |
| M2 (agent) | fixed | `send_sms` uses key `send_sms:<taskId>` and `oncePerKey`: a second reply in one task is refused. |
| M3 (agent) | fixed | `store.optOut` discards `PENDING` drafts in the same transaction. |
| M5 | fixed | Shared guard: bare domains, shortener TLDs, booking link compared by protocol, host and path prefix (no userinfo), price and guarantee text → fallback `price_or_guarantee`, international, full-width and 7-digit phone numbers. |
| M6 | fixed | Injection check runs on NFKC text without zero-width characters, with collapsed whitespace and leetspeak folded; new patterns for "you're now", "from now on you", `system:` lines and `<<<`/`>>>`. `smsTurnMessage` removes `<<<`/`>>>` from lead text. |
| L5 | fixed | `book_meeting` invites only the email on record or one the lead typed in an inbound SMS. The event description no longer holds the phone. |
| L7 | fixed | A planning error completes the task with `failed: the task could not be planned`. |

- The agent hook `hooks/outbound-guard.ts` now imports `@crm/validation/outbound-guard`; it keeps only the agent constants, `outboundSmsInput`, `attemptedViolations` and the observe hook.
- god approved `sms_lockdown` in `packages/telemetry/src/allowlist.ts` and `apps/app/lib/agent-transcript.ts` (separate commit).

## Commands and results

| Command | Result |
|---|---|
| `bun test test/sms-*.spec.ts test/outbound-guard.spec.ts test/drain.spec.ts test/custom-agent-runtime.spec.ts` (apps/agent) | pass, 259 |
| `bun test --preload <pglite> test/sms-store.integration.spec.ts` (apps/agent) | pass, 4 |
| `bun test --preload <pglite> test/core-loop.integration.spec.ts` (apps/api) | pass, 7 |
| `bun test test/sms-drafts.spec.ts` (apps/api) | pass, 25 |
| `bun test` (packages/validation) | pass, 85 |
| `bun test test/allowlist.spec.ts` (telemetry), `test/agent-transcript.spec.ts` (app) | pass, 26 and 45 |
| `check-types`, `biome check` (apps/agent, packages/validation) | pass; 1 pre-existing warning in `agent/lib/tasks.ts` |
| `lint:slop` | my files pass; fails on `apps/api/test/compliance-fixes.spec.ts` (fix-api, uncommitted) |
| `lint:dead` | no finding in apps/agent or packages/validation; pre-existing findings elsewhere |

## Not run / not done

- `eve eval` (spends credits). No eval asserts the lockdown in a live model turn; the unit tests call the resolver.
- No per-turn random fence marker: lead text can no longer hold the fence characters, and they trigger a hand-off.
- `\bguarantee` also blocks "guaranteed issue" product names; such a reply falls back to the safe text.

# Security fixes — API and DB side (worker-crm-fix-api)

Date: 2026-10-03. bun 1.3.12. Findings from `docs/COMPLIANCE_SECURITY_REVIEW.md`. Scope: `apps/api`,
`packages/db`, `packages/auth`.

## Schema (additive migration `20261003170000_consent_phone_retention`)

- `ConsentRecord.e164` (back-filled from `Contact.phone`), `contactSnapshot Json?`, `detachedAt`.
  `contactId` is now nullable with `onDelete: SetNull`, so a purge keeps the row. Index `(e164, revokedAt)`.
- `SmsDraft.idempotencyKey String?`: the agent stores its original send key here (agent side, f18e38a).
  This migration is the only one that adds the column; fix-agent's planned `20261003171000` was not created.

## What changed

| Finding | Status | Where |
|---|---|---|
| H1 free-text opt-out | fixed (API part) | `sms/keywords.ts` `optOutIntentOf`, phrase list `SMS.optOutPhrases`; `KeywordService.optOut` |
| H2 opt-out confirmation | fixed (API part) | gate purpose `opt-out-confirmation`; `SmsInternalService.optOutConfirmation` |
| H3 consent per phone | fixed | `ConsentService.hasActiveConsent({ contactId, e164 })`; gate, first touch, threads, writer, START |
| H4 purge keeps proof | fixed | `ContactsService.purge`, `compliance/consent-retention.ts`, `COMPLIANCE.retention` |
| H5 double send on approve | fixed (API part) | `SmsDraftsService.priorSend` |
| M1 strictest state | fixed | `sendWindowFor` unions declared and area-code states; gate reads `sms_state` |
| M2 frequency cap | fixed | `frequencyRetryAt`, `COMPLIANCE.frequency` (3 per day, 7 per week, unanswered) |
| M3 STOP keeps drafts | fixed (API part) | `KeywordService.stopEverything` discards `PENDING` drafts |
| M4 gate before wait | fixed | `SmsSender.send` reserves the limiter slot, then gates, then sends |
| M7 role checks | fixed | `ComplianceAdminService`, `@crm/auth` `canManageCompliance` / `canImportLeads` / `canSendSms` |
| L1 aborted body | fixed | `raw-body.ts` settles on `aborted` / `close` |
| L2 stale claim | fixed | `SmsInternalService.reclaimStale` (5 min lease, no matching `SmsMessage`) |
| L4 non-US numbers | fixed (gate) | gate blocks a conversation text to a number without `+1` |
| QA issue 2 replay check | fixed | `SmsInternalService.replay` compares contact and a SHA-256 of the text |
| L3 per-process limiter | not fixed | operational: run one API instance that sends |

- Inbound free text that matches the phrase list: the inbound message is stored, the number is suppressed
  (`OPT_OUT_REQUEST` or `WRONG_NUMBER`), consent for the contact and the number is revoked, open SMS tasks
  finish `opted-out`, `PENDING` drafts become `DISCARDED`, one fixed confirmation goes out. No `sms-reply` task.
  The LLM classifier stays the backup for phrasing the list misses. The list is a keyword rule, not a model.
- Inbound text from a suppressed number or a number without active consent for that phone is stored
  (`stored-no-reply`) and queues no `sms-reply` task. `smsDrafts.handBack` does the same check.
- `opt-out-confirmation`: the API ignores the caller's text and sends a fixed text (`optOut` or `wrongNumber`).
  It needs a `PhoneSuppression` row created in the last 5 minutes, and it goes out once per suppression
  (claim `AgentEvent` `opt-out:<e164>:<createdAt ms>`; bridge key the same). Quiet hours do not apply.
  A repeat answers `blocked` `suppressed`, so the agent refuses and drafts nothing.
- New gate reasons `frequency-cap` and `unsupported-number` answer `failed` with an error text on the bridge.
  `@crm/validation/sms-send` `SMS_BLOCK_REASONS` is unchanged (outside scope).
- Purge keeps `AgentEvent` rows of sessions `compliance:send-gate`, `sms:send`, `sms:keyword` and detaches
  consent rows with a snapshot (name, phone, purge time, retain until purge + 5 years).
- Draft approval sends with `draft.idempotencyKey ?? sms-draft:<id>`. A draft with a key checks receipt `sms-send:<key>` first; without a key, a
  `no-send-path` / `send-failed` draft checks the task's `conversation` / `first-touch` receipts. Sent →
  draft `DISCARDED`, answer "already sent". Claimed → "in progress".
- Roles: `settings.setSms`, `settings.setArchiveRetention`, `leads.importCommit` need owner or admin. Every
  `smsDrafts` mutation needs a workspace member. `setSms` and `importCommit` write an `AgentEvent`
  (session `compliance:admin`).
- `SMS_GUARD_REASONS` gained `price_or_guarantee` for the shared guard change (fix-agent). One label line in
  `apps/app/lib/sms-drafts.ts` follows (outside scope, unavoidable: the app typecheck failed without it).

## Commands and results

| Command | Result |
|---|---|
| `bun run test` sms, compliance, lead, calendar, quiet-hours-table specs (apps/api, unreachable `TEST_DATABASE_URL`) | pass, 252 |
| `bun test test/compliance-roles.spec.ts` (packages/auth) | pass, 2 |
| New regression tests on the pre-fix source | 19 behaviour tests fail before, pass after; drafts and bridge tests: 11 fail before |
| `bun run check-types` (root, turbo) | pass, 13/13 |
| `bun run lint` (root, turbo) | pass, 9/9 |
| `bun run lint` in apps/api, packages/auth, packages/db | pass (old warnings only) |
| `oxlint` on every touched file | pass |
| `prisma validate`, `prisma generate`, `migrate diff` against the previous schema | pass; diff equals the migration |
| `bun test --preload <pglite> test/core-loop.integration.spec.ts` (apps/api, all 62 migrations) | pass, 7 |
| `bun run lint:dead` (knip) | no new findings from these files (pre-existing findings remain) |
| `nestjs-trpc generate` into a temp dir | only import paths differ; `server.ts` not regenerated |

## Not run / not done

- No real Postgres. PGlite ran every migration in the core-loop test. The back-fill UPDATE, the JSON-path
  receipt query and the purge are tested through fakes only.
- The settings UI does not hide the controls for a member; the API answers 403.
- Frequency cap is a constant in `COMPLIANCE.frequency`, not a settings field.
- Purge does not suppress the phone. Decide with counsel.

## Security fixes round 2 — agent side (worker-crm-fix2-agent)

| Item | Status |
|---|---|
| R1 purpose gate on the 16 CRM tools without one | fixed. `assertNotSmsPurpose` runs first in each. `set_chat_title` already refuses non-builder sessions. |
| R1 `purposeOf` order | fixed. An SMS `taskKind` now wins over a `purpose` attribute. |
| R1 runtime proof | partly fixed. `test/sms-deny-by-default.spec.ts` runs the real `execute` of every authored tool and every subagent tool with an SMS context and a hostile `purpose`/`runId` set. All refuse. |
| R1 allowlist inversion | not fixed (eve limit). eve exposes no API to remove a tool. The stub list stays, and each tool now refuses on its own. `sms-lockdown.spec` fails when a tool is neither allowed nor locked. |
| Stored injection via `coverage` | fixed. `sanitizeCoverage` in `@crm/validation/sms-qualification` keeps letters, digits and `. , ' & % $ / + -`. It runs on write and on read. |
| `send_sms` key fallback to `callId` | fixed. A session with no `taskId` is refused. |
| `subagents/.claude` breaks lockdown spec | fixed. The spec ignores dot-entries. `.gitignore` lists the directory. |

Not proven: the real eve runtime (durable step replay of the stubs, runtime-action routing of subagent calls). No eve eval ran: no model credentials.

# Security fixes round 2 — API side (worker-crm-fix2-api)

Source: `docs/COMPLIANCE_RECHECK.md` R2..R7. Commits: `a1edfdb` (R2), `933ee03` (R3, R4, R6, R7),
`3d1e2ab` (repair of hunks I misplaced in the two commits above), and the R5 commit that follows.

| Item | Status | What changed |
|---|---|---|
| R2 opt-out phrases | fixed | `keywords.ts` folds text with NFKC, Cyrillic/Greek look-alikes, accents, zero-width marks, `S T O P` / `s.t.o.p` spacing, repeated letters (`stoooop`) and `txt`/`msg` slang. A stop word (`stop`, `stahp`, `unsub`...) in a message of 40 characters or fewer suppresses. New phrases: `send me any more`, `text me anymore`, `cease and desist`. Config: `SMS.optOutPhrases`. |
| R3 timeout | fixed | `TelnyxUnknownOutcomeError` for a fetch failure or a 2xx without id. `SmsSender` rethrows it as `SendOutcomeUnknownError`. The receipt becomes `sms.send.unknown`. It is never reclaimed and never released. A repeat call answers `unknownOutcome`. Draft approve answers `unknownOutcome` and sends nothing. |
| R4 cap race | fixed | The gate counts other in-flight receipts: `claimed` within the 5 minute lease and `unknown` within the week, for purposes conversation, first-touch and handoff. It skips its own receipt (`receiptId`). The API already rejects a missing or empty idempotency key (`smsSendRequest`). |
| R5 roles | fixed | `procedure-roles.ts` plus `AuthMiddleware`. Admin-only: `settings.*`, `apiKeys.create`, `agents.deploy`, `*.purge`, `*.bulkPurge`, `leads.importCommit`, `currency.*`, `slack.disconnect`, `sso.*`, `tracking.*`, `workspace.update`, `workspace.setMemberRole`. Owner escalation: only an owner can set or change `owner` (`canAssignOwner` in `@crm/auth`). `contacts.update` needs admin only when the phone changes. |
| R6 confirmation retry | fixed | `SmsSender` deletes the opt-out claim row when Telnyx refuses the send. An unknown outcome keeps the claim. |
| R7 START | fixed | START grants consent only when the contact's phone is the sender and the number had a consent row (any state) or a lifted suppression. A WRONG_NUMBER suppression stays. |
| N4 backfill note | documented | See below. |

## Decisions

- **Unknown outcome needs a person.** No webhook can reconcile it: the send has no Telnyx id. The rep checks Telnyx.
  If the text did not arrive, the rep discards the draft and sends a new text from the composer (new key).
  No approve override exists, so the contract and the UI are unchanged.
- **Any fetch failure is "unknown".** A DNS failure is also unknown. The cost is one manual check. The gain is no double text.
- **The cap is conservative under a burst.** Parallel sends each count the others in flight. Two sends at the edge can both
  be blocked. Neither exceeds the cap. A blocked send retries after the in-flight send settles.
  A claimed receipt whose `SmsMessage` row exists but is not yet settled counts twice for a few milliseconds.
- **False positive of the stop word rule.** A short message that holds the word `stop` suppresses the number, for example
  `How do I stop my renewal`. A person lifts it with START. `Stop by at 5`, `stop in`, `don't stop`, `bus stop` are excluded
  (`SMS.optOutPhrases.benignStop`). A message over 40 characters needs an explicit phrase.
- **START semantics.** The consent row has source `SMS_KEYWORD`, `optInText` is the message text, `capturedAt` is the receipt time.
  A number with no history that texts START stays unconsented. A person adds consent through a lead import or a web form.
- **Role classes.** `member` can still edit everything except a contact's phone. `*.purge` is now admin on contacts, companies
  and deals. `fields.*`, `google.*`, `microsoft.*`, `agents.*` (except deploy) stay `member`: their services check ownership.
- **Better Auth.** Its own `/organization/update-member-role` already blocks a non-owner from setting or changing an owner
  (`crud-members.mjs`). The tRPC path was the gap.
- **Backfill assumption (N4).** Migration `20261003170000_consent_phone_retention` sets `ConsentRecord.e164` from the
  contact's current phone. A consent row given for an earlier number, on a contact whose phone was edited before the
  migration, now covers the new number. Before production deploy, run a check for contacts whose phone changed after the
  consent row was created (`SELECT` on `ConsentRecord` joined to `Contact`, `Contact.updatedAt > ConsentRecord.capturedAt`),
  and revoke the rows it finds. Test data is not affected.

## Commands and results

| Command | Result |
|---|---|
| `bunx tsc --noEmit` in `apps/api`, `packages/auth` | pass |
| `bunx biome check .` in `apps/api`, `packages/auth` | pass (4 old warnings in `apps/api`) |
| `bun test --preload pglite-preload.ts` in `apps/api` | 672 pass, 7 fail: 5 `Auth (e2e)` and 1 `Tracking collector` bind a port (sandbox: EPERM) |
| `test/core-loop.integration.spec.ts` (PGlite) | pass, 7 |
| New specs: `compliance-fix2.spec.ts` (22), `procedure-roles.spec.ts` (27), R2 block in `sms-keywords.spec.ts` | pass; the R3, R4 tests fail with the fix removed (checked for R4) |
| `bun test` in `packages/auth` | pass |

## Not run / not done

- `Auth (e2e)` specs need a listening port. The middleware is covered by unit calls, not through HTTP.
- No real Postgres concurrency test for R4. The race test uses the in-memory fake and sequenced promises.
- No alert to a rep when a send ends `unknown`. The log line is `SMS send outcome unknown`.
- `apps/app` UI does not show the `unknownOutcome` text specially. It shows the API error string.
- Role class for `fields.*` schema changes stays `member`. A decision for the owner.
- Cross-scope: `apps/api/test/fields.spec.ts` (one call site for the new `actingUserId` argument).

# Build status — Polish (worker-crm-polish)

Date: 2026-10-03. bun 1.3.12.

## 1. Business name in texts (toll-free reviewer concern)

- `AppSetting.sms.brandName` (`@crm/validation/sms-settings`, `brandName`, at most 80 characters, no link or
  email). Empty means the workspace name, then "Our team" (`resolveBrand`). Edited on Settings → Compliance.
- Where the name now appears: first message (`{agency}` token), booking confirmation (`confirmationText`
  starts with `<brand>: `), STOP and HELP replies and the opt-out confirmation (API `readBrand`, `sms/sms-brand.ts`),
  and the first agent reply of a conversation.
- First agent reply: `shouldIdentify(history)` is true while the thread holds at most
  `SMS_AGENT.identify.maxEarlierOutbound` (1) outbound text, so the first-touch text counts as the first and the
  first agent reply is the second. The turn message carries `Business name:` and `Identify the business: yes|no`;
  the session attribute `identify` carries the flag. `deliver()` enforces it: with `identify` it calls
  `withBrand`, which adds `<brand>: ` unless the text already names the brand. The guard still runs after that.
- `skills/sms-conduct.md` rule 14. Rules 1–13 are unchanged. Evals: two cases in `evals/sms/cases.ts`
  (`brand: named` and `not-repeated`), asserted in `replies.eval.ts`. `eve eval` was NOT run (spends credits).
- `SmsStore.brand()` is new; `test/support/sms-fakes.ts` has `workspaceName`.

## 2. SMS agent sessions in the contact's Agent tab

- Cause: the Agent tab lists `AgentConversation` rows owned by the signed-in rep. An SMS session is started by the
  agent for the contact and no rep owns it, so no row exists. Its steps are in `AgentEvent` under session id
  `…sms:<contactId>` (eve adds its channel prefix).
- New read-only query `sms.agentSessions({ contactId })` (`GET /sms/threads/{contactId}/agent-sessions`) returns the
  events of sessions whose id ends in `sms:<contactId>` (latest 2,000, `truncated` flag).
- `SmsAgentSessions` (`apps/app/components/crm/sms-agent-sessions.tsx`) sits above the research chat in the Agent
  tab: a collapsed, read-only transcript. It renders nothing when there is no session. It reuses `Item` from the
  agent panel (now exported).

## 3. Calendar and frequency cap settings

- `settings.calendar` (query) returns `calendar.ownerUserId`, `calendar.fallbackBookingLink`, the connected Google
  users (one row per user) and the effective owner. `settings.setCalendar` saves them; the owner must have a
  Google account. Gated by `ComplianceAdminService.require(..., "complianceSettings")` (owner or admin), audited as
  `settings.calendar.changed`.
- `settings.complianceLimits` returns the cap from `COMPLIANCE.frequency` (3 a day, 7 a week). The page shows it
  read-only: it stays a constant, not a setting.
- Compliance page: new Booking card (owner picker, fallback link); frequency text in the Texting card.

## 4. Licensed states configurable

- `AppSetting.sms.licensedStates` (array of two-letter codes, default empty = no state refused).
  `SMS_AGENT.licensedStates` is removed. `classify_reply` and `record_qualification` read the setting.
  The turn message has a `Licensed states:` line. `knowledge-agency.md` tells the model to use only that line.
- The test that tied the states to `knowledge-agency.md` now asserts the skill holds no hard coded state and
  points at the `Licensed states:` line, and tests `judgeQualification` with the configured list.

## 5. Small items

- `SMS_BLOCK_REASONS` gains `frequency-cap` and `unsupported-number`. The API no longer maps them to `failed`
  (`SMS_INTERNAL.blockedAsFailed` is gone). The agent holds a frequency cap as `send-failed` and refuses an
  unsupported number. The UI labels both (`lib/sms-drafts.ts`).
- Confirmed: `opt_out_contact` → `optOutLead` → `prismaSmsStore.optOut` moves pending `SmsDraft` rows to
  `DISCARDED` (covered by `test/sms-store.integration.spec.ts`; the keyword path by the M3 test).
- BUILD_STATUS: the `SMS_DRY_RUN` mention is corrected to `DRY_RUN`.

## Commands and results

| Command | Result |
|---|---|
| `bun run check-types` in `packages/validation`, `apps/api`, `apps/agent`, `apps/app` (after `next typegen`) | pass |
| `bun run lint` (biome) in the same four | pass (warnings are old) |
| `bun run lint:slop` | no findings in my files; 5 old findings in `apps/agent/test/sms-deny-by-default.spec.ts` |
| `bun test` in `packages/validation` | pass, 92 |
| `bun test` in `apps/app` | pass, 201 |
| `bun test test/sms-*.spec.ts test/outbound-guard.spec.ts` in `apps/agent` | pass, 287; the 4 `sms-store.integration` tests pass with the PGlite preload |
| API specs for sms, compliance, leads, calendar, settings, keywords, drafts | pass, 258 |
| PGlite core-loop e2e (`test/core-loop.integration.spec.ts`) | pass, 7 |

Checked in a clean worktree of HEAD plus only these changes, because worker-crm-fix2-api had uncommitted edits
in the same API files.

## Not run / not done

- `eve eval` (model credits). `next build` (fonts.googleapis.com unreachable in the sandbox).
- No UI test of the new forms or the transcript rendering; the pure helpers are tested.
- `docs/OPERATIONS.md` ("Change licensed states", "Calendar owner…") and `docs/TOLLFREE_VERIFICATION.md`
  still describe the code-edit way. Out of scope; they need an edit.
- The frequency cap is shown, not editable.
- Cross-scope edits (needed to make the setting work): `apps/api/src/leads/first-touch.service.ts`,
  `leads-config.ts`, `apps/api/src/sms/{keyword.service,sms-internal,sms-internal.service,sms-threads*,sms.router,sms-config}.ts`,
  `compliance-config.ts` (audit type), `test/support/sms-db.ts`, regenerated `generated/server.ts`.
- No Prisma change.

# Final QA (worker-crm-qa2)

Date: 2026-10-03. HEAD at start `11013cc`. Full report: `docs/QA_REPORT.md`. Handoff: `docs/HANDOFF.md`.

| Item | Status |
|---|---|
| oxlint anti-slop findings (11) | fixed in `51b2c3d`. No behaviour change. |
| knip unused exports from SMS code (30) | fixed in `51b2c3d`. Remaining knip findings are upstream. |
| `procedure-roles.spec` stale key | already green at HEAD. |
| e2e for security paths | `test/sms-security-paths.integration.spec.ts`, 16 tests, `013e678`. |
| Docs for settings (business name, licensed states, calendar, frequency cap) | `649c14f`. |
| 7 port-binding specs | run in process with a `light-my-request` stand-in for `supertest`. 6 tests pass. Preload in `QA_REPORT.md`. |

Results: check-types 13/13, lint 9/9, slop pass, 1,922 tests pass and 1 fails (telemetry two-process, needs a real server). 61 migrations apply with no drift. Secrets scan clean.

Not run: real Postgres, real Telnyx and Google, eve runtime and evals, `next build`, carrier verification, legal review.

# Local dev sign-in (worker-crm-devlogin)

Date: 2026-10-03. Docs: `SMS_SETUP.md` → "Local sign-in without OAuth".

| Item | Status |
|---|---|
| `DEV_LOGIN="true"` adds a "Continue as <first ALLOWED_SIGN_IN address>" button | `packages/auth/src/dev-login.ts` (pure rules), `dev-login-plugin.ts` (route `POST /api/auth/dev-login`), `apps/app/app/(landing)/sign-in/dev-sign-in.tsx` |
| Fails closed | Plugin is registered only when `resolveDevLogin` returns enabled. Route does not exist otherwise. |
| Boot refusal | `DEV_LOGIN=true` with `NODE_ENV=production`, a non-loopback `API_URL`/`APP_URL`, or no full address in `ALLOWED_SIGN_IN` throws in `@crm/auth` env, API `validateEnv` and `next.config.ts`. |
| Route guard | The handler also rejects a non-loopback request host or `Origin`. |
| Allow-list | User is created through Better Auth's adapter, so the `user.create.before` allow-list hook, session hooks and first-user-owner logic run as for OAuth. |
| Tests | `packages/auth/test/dev-login.spec.ts` (10), `apps/api/src/config/env.validation.spec.ts` (5). |

Not run: the route against a real Postgres and a browser. No Google/Microsoft `account` row is created, so Gmail, Calendar and booking need real OAuth. `next.config.ts` (outside the listed scope) got a one-line boot guard.
