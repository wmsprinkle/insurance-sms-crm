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
  `SMS_DRY_RUN=true` in env still forces dry for every request.
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
