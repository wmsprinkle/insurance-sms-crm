# Insurance SMS CRM — setup

For the person who installs and runs this CRM. Upstream setup detail (agent TUI,
migrations on deploy, tests) stays in [`setup.md`](./setup.md). Daily use is in
[`OPERATIONS.md`](./OPERATIONS.md). The carrier paperwork is in
[`TOLLFREE_VERIFICATION.md`](./TOLLFREE_VERIFICATION.md).

What is tested and what is not: [`BUILD_STATUS.md`](./BUILD_STATUS.md). Read its
"Not run" lists before you go live.

## 1. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.com) | 1.3.x (the build used 1.3.12) | Package manager and test runner. `npx` does not work in this repo; use `bunx`. |
| Node.js | 22 or newer | Next.js, NestJS and eve run on Node. |
| Docker | any recent | Runs Postgres 17 from `docker-compose.yml` (user `postgres`, password `postgres`, database `crm`, port 5432). |
| `openssl` | any | Generates secrets. |

`bun install` downloads Prisma engines from `binaries.prisma.sh`. That host must be
reachable.

## 2. Environment variables

There is one `.env`, at the repo root. All three processes (app, API, agent) read it.
`.env.example` is the only example file in the repo. A real environment variable wins
over the file.

"Required" means the API does not boot without it, or the named feature does not work.

### Core (upstream)

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection. The example value matches `docker compose`. |
| `DIRECT_DATABASE_URL` | Only with a pooler | Unpooled URL for `prisma migrate deploy` on Vercel. `POSTGRES_URL_NON_POOLING` is the fallback. |
| `TEST_DATABASE_URL` | For `bun run test` | Throwaway database. The name must end in `_test`. `bun run db:test` creates it. |
| `BETTER_AUTH_SECRET` | Yes | Session signing. `openssl rand -base64 32`. App and API must hold the same value. |
| `ALLOWED_SIGN_IN` | Yes | Who may sign in: email domains and/or single addresses, comma-separated. Empty = nobody. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes for booking | Google sign-in, Gmail and Calendar. Set both or neither. Booking needs Google. |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | No | Microsoft sign-in and Outlook mail. Microsoft calendar booking is not built. |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | No | Slack linking. Also needs `FEATURE_SLACK="true"`. |
| `IS_MARKETING` | No | Serves the upstream landing page at `/`. Leave unset. |
| `API_URL` | Off localhost; **always for the agent** | API origin (default `http://localhost:3001`). The agent posts SMS sends and bookings to it. Without it the agent drafts every text with reason "no send path". |
| `APP_URL` | Off localhost | App origin (default `http://localhost:3000`). |
| `AUTH_COOKIE_DOMAIN` | Only on split subdomains | Parent domain such as `.example.com`. |
| `AGENT_URL` | For the Agent tab | Agent origin. Locally `http://127.0.0.1:2000` (IPv4; `eve dev` does not listen on `::1`). |
| `AGENT_PORT` | No | Port of a self-hosted agent (default 2000). |
| `AGENT_BRIDGE_SECRET` | **Yes for SMS** | See section 6. |
| `PORT` | No | API port (default 3001). |
| `AI_GATEWAY_API_KEY` | Yes off Vercel | Model access. See section 8. |
| `PERPLEXITY_API_KEY`, `GITHUB_TOKEN` | No | Upstream research tools. Off unless `FEATURE_ENRICHMENT="true"`. |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob for logos and photos. |
| `REDIS_URL`, `CACHE_TTL_MS` | No | Shared cache. Without it each instance caches in memory. |
| `CRON_SECRET` | For mailbox sync | Bearer token for `POST /internal/sync/google` and the tracking sweep. At least 16 characters. |
| `PRISMA_LOG_QUERIES` | No | `"true"` logs SQL at debug level. |
| `CRM_TELEMETRY_DISABLED` / `DO_NOT_TRACK` | No | `"1"` turns off the daily anonymous telemetry event. See `telemetry.md`. |

### Insurance SMS CRM additions

| Variable | Required | What it does |
| --- | --- | --- |
| `FEATURE_ENRICHMENT` | No | `"true"` turns on Context.dev, LinkedIn and Perplexity lookups. Off by default. |
| `FEATURE_SLACK` | No | `"true"` turns on Slack linking. Off by default. |
| `FEATURE_TRACKING` | No | `"true"` turns on public website tracking. Off by default. |
| `DRY_RUN` | No | Any value except exactly `"false"` keeps dry run on. In the API, dry run is also forced when `TELNYX_API_KEY` is empty. In the agent, it sets `dryRun` on every send request. Dry run stores messages with ids `dryrun-…` and calls nobody. |
| `TELNYX_API_KEY` | To send live | Telnyx Portal → API Keys. Bearer token for `POST /v2/messages`. |
| `TELNYX_MESSAGING_PROFILE_ID` | To send live | Messaging profile that owns the number. |
| `TELNYX_FROM_NUMBER` | To send live | The verified toll-free number in E.164, for example `+18005550100`. |
| `TELNYX_PUBLIC_KEY` | To receive | Telnyx Portal → Keys & Credentials → Public Key (base64). Verifies inbound webhooks. Unset: `POST /webhooks/telnyx` answers 503. |
| `TELNYX_MPS` | No | Messages per second per sending number. Default 1. |
| `LEAD_INGEST_SECRETS` | For the lead webhook | See section 7. Unset: `POST /leads/ingest` answers 503. |

The API declares its variables in `apps/api/src/config/env.validation.ts`. The agent
reads `API_URL`, `AGENT_BRIDGE_SECRET` and `DRY_RUN` directly. Turbo runs with strict
env: `apps/agent/turbo.json` passes `AGENT_BRIDGE_SECRET`, `AI_GATEWAY_API_KEY`,
`API_URL`, `BLOB_READ_WRITE_TOKEN`, `DATABASE_URL`, `DRY_RUN`, `GITHUB_TOKEN` and
`PERPLEXITY_API_KEY` to the agent's `dev` tasks. A variable missing from that list does
not reach the agent under `bun run dev`.

## 3. Local run in dry run, with the sample CSV

```sh
cp .env.example .env
# Set BETTER_AUTH_SECRET, ALLOWED_SIGN_IN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
# Add these lines:
#   DRY_RUN="true"
#   API_URL="http://localhost:3001"
#   AGENT_URL="http://127.0.0.1:2000"
#   AGENT_BRIDGE_SECRET="<openssl rand -base64 32>"
#   AI_GATEWAY_API_KEY="<your key>"          # only for model replies
bun install
docker compose up -d                          # Postgres on :5432
bun run db:deploy                             # apply migrations
bun run dev                                   # app :3000, API :3001, agent :2000
```

The agent pane under `bun run dev` is the interactive eve TUI. Select it and press
Enter. Without a TUI, run `bunx turbo run dev:headless --filter=agent` in a second
terminal. See `setup.md` → "Running the agent".

Then:

1. Open `http://localhost:3000` and sign in with an address in `ALLOWED_SIGN_IN`.
2. Go to **Settings → Compliance**. Check the first message, the disclosure mode and
   **Auto-send**. Leave auto-send off for the first test: every text becomes a draft.
3. Go to **Contacts → Import** (`/<workspace>/contacts/import`). Upload
   [`docs/sample-leads.csv`](./sample-leads.csv). Accept the suggested mapping. Check the
   preview, then import.
4. Each new lead gets one `first-touch` task. Its due time is the next allowed send
   window for the lead's state or area code. Outside 8:00–21:00 local time (stricter in
   some states) the task waits.
5. When the task runs, the first message appears in **Inbox → Drafts**
   (`/<workspace>/inbox/drafts`). Approve it. In dry run the message is stored as sent
   with an id `dryrun-…`. Telnyx gets nothing.

Inbound texts cannot be simulated from the UI. To test the reply path locally you need
a signed Telnyx webhook (section 4) or the unit tests in `apps/api/test/sms-*.spec.ts`.

## 4. Connect Telnyx

Do this only after the toll-free number is verified. Unverified toll-free numbers cannot
send. See [`TOLLFREE_VERIFICATION.md`](./TOLLFREE_VERIFICATION.md).

1. **Messaging profile.** Telnyx Portal → Messaging → create a profile. Copy its id into
   `TELNYX_MESSAGING_PROFILE_ID`.
2. **Toll-free number.** Buy a toll-free number and assign it to that profile. Put it in
   E.164 in `TELNYX_FROM_NUMBER`. One toll-free number carries one use case; do not
   share it with another campaign.
3. **Webhook URL.** On the messaging profile, set the inbound webhook URL to
   `https://<your-api-host>/webhooks/telnyx` (the API origin, not the app). The API
   handles `message.received`, `message.sent` and `message.finalized`.
4. **Public key.** Portal → Keys & Credentials → Public Key. Copy the base64 value into
   `TELNYX_PUBLIC_KEY`. The API checks the Ed25519 signature over
   `{telnyx-timestamp}|{raw body}` and refuses events older than 300 seconds (401).
5. **API key.** Portal → API Keys. Put it in `TELNYX_API_KEY`.
6. **Go live.** Set `DRY_RUN="false"` on the API **and** the agent. Restart both.

Telnyx retries a webhook that does not answer in about 2 seconds. The controller only
verifies, stores and queues a task, so it answers fast. A retry with the same message
id is stored once.

## 5. Google OAuth for calendar booking

1. Google Cloud console → Credentials → OAuth client ID → Web application.
2. Authorised redirect URIs: `http://localhost:3001/api/auth/callback/google` and, in
   production, `https://<your-api-host>/api/auth/callback/google`.
3. Enable the **Gmail API** and the **Google Calendar API**.
4. On the consent screen, add the scopes the app requests:
   - `https://www.googleapis.com/auth/calendar.readonly` (upstream sync)
   - `https://www.googleapis.com/auth/calendar.events` (insert the invite)
   - `https://www.googleapis.com/auth/calendar.freebusy` (find free slots)
   - `https://www.googleapis.com/auth/gmail.readonly` (upstream mailbox sync)
   On Google Workspace, set **User type: Internal**. `gmail.readonly` is a restricted
   scope; an External app needs Google verification.
5. Copy the client id and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

**Re-consent.** A Google account connected before the booking scopes existed keeps
syncing but cannot book. **Settings → Connections** shows **Grant calendar access** for
that account. Click it and accept the new scopes. Until then, booking answers
`needs-reconsent` and the agent falls back (see `OPERATIONS.md` → "Calendar owner").

Microsoft calendars are not supported for booking.

## 6. `AGENT_BRIDGE_SECRET`

One shared secret, the same value in the app, the API and the agent.

```sh
openssl rand -base64 32
```

It authorises:

- the agent → API calls `POST /internal/sms/send` and `POST /internal/calendar/book`
  (header `Authorization: Bearer <secret>`);
- the app → agent proxy behind the contact **Agent** tab;
- the API → agent dispatch poke.

Unset on the API: the two internal routes answer 503. Unset on the agent: it cannot send
and every text becomes a draft with reason "no send path". Different values: 401.

## 7. `LEAD_INGEST_SECRETS` (lead webhook)

`POST <API_URL>/leads/ingest` accepts one lead per request from a signed source.

```sh
LEAD_INGEST_SECRETS="webform:<secret of 16+ chars>,partnerx:<another secret>"
```

A source id is lower-case letters, digits, `-` or `_`. Each request carries:

| Header | Value |
| --- | --- |
| `x-lead-source` | The source id. |
| `x-lead-timestamp` | Unix seconds, within 5 minutes of now. |
| `x-lead-signature` | `sha256=` + hex HMAC-SHA256(secret, `"<timestamp>.<raw body>"`). |

Body (JSON, at most 32 KiB):

```json
{
  "phone": "+12025550101",
  "firstName": "Ava",
  "lastName": "Example",
  "email": "ava@example.com",
  "consent": {
    "source": "WEB_FORM",
    "capturedAt": "2026-10-01T15:04:05Z",
    "optInText": "I agree to receive texts from <Agency> about my quote request. Msg & data rates may apply. Reply STOP to opt out.",
    "optInUrl": "https://example.com/quote",
    "ip": "203.0.113.10"
  }
}
```

`consent.source` is one of `WEB_FORM`, `LEAD_IMPORT`, `API`, `SMS_KEYWORD`, `MANUAL`.
`optInText` or `optInUrl` is required. Answers: 200 `created` or `duplicate`, 422
`rejected` with reasons, 400 bad JSON, 401 bad signature or timestamp, 413 too large,
503 secrets not set.

## 8. Model access (Vercel AI Gateway)

The agent reaches its model through the Vercel AI Gateway. There is no provider SDK.

- On Vercel, OIDC handles authentication. Set nothing.
- Elsewhere, set `AI_GATEWAY_API_KEY` (https://vercel.com/docs/ai-gateway).
- The model is a setting, not a variable: **Settings** (workspace page) → agent model.
  The upstream default is `zai/glm-5.2-fast`.

Without a gateway credential, first-touch texts still go out (they use no model), but
replies to inbound texts fail at the model turn. The SMS evals (`apps/agent/evals/sms`)
skip without a credential.

## 9. Deploy shape

Same as upstream: three deployments and one Postgres.

| Deployment | Code | Needs |
| --- | --- | --- |
| App (Next.js) | `apps/app` | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `API_URL`, `APP_URL`, `AGENT_URL`, `AGENT_BRIDGE_SECRET` |
| API (NestJS) | `apps/api` | Everything in section 2 that the API declares, including the Telnyx and lead-ingest variables |
| Agent (eve) | `apps/agent` | `DATABASE_URL`, `API_URL`, `AGENT_BRIDGE_SECRET`, `DRY_RUN`, `AI_GATEWAY_API_KEY` (off Vercel) |

- `DATABASE_URL` and `BETTER_AUTH_SECRET` must match across deployments. A mismatch is a
  sign-in redirect loop.
- The agent drains its task queue once a minute from its own schedule
  (`apps/agent/agent/schedules/dispatch.ts`). First-touch and reply tasks wait for it.
- The Telnyx webhook and the lead webhook point at the API origin.
- `apps/api/src/generated/server.ts` is committed. `build` never regenerates it.
- Migrations run with `bun run db:deploy`. This fork adds four:
  `20261003140000_sms_consent_suppression`, `20261003150000_sms_settings_handled`,
  `20261003153000_sms_drafts_handoffs`, `20261003160000_calendar_settings`.
  None of them has run against a real database yet.

## 10. Going-live checklist

- [ ] Toll-free verification approved for the number in `TELNYX_FROM_NUMBER`.
- [ ] Opt-in page, privacy policy and terms are public (see `TOLLFREE_VERIFICATION.md`).
- [ ] Every imported lead has a consent source, a capture time and opt-in text or URL.
      No purchased or third-party affiliate leads.
- [ ] Quiet-hours table reviewed by a lawyer (`apps/api/src/compliance/compliance-config.ts`,
      shown read-only on **Settings → Compliance**). It is unverified.
- [ ] Licensed states set (see `OPERATIONS.md`).
- [ ] Knowledge files reviewed for your lines of insurance (no prices, no promises).
- [ ] Disclosure mode chosen. `disclose` is the default; some states require it.
- [ ] First message matches the sample message submitted for verification.
- [ ] `AGENT_BRIDGE_SECRET` identical in app, API and agent.
- [ ] `API_URL` set on the agent.
- [ ] Google account connected with booking scopes (no **Grant calendar access** prompt).
- [ ] `calendar.ownerUserId` and `calendar.fallbackBookingLink` set (see `OPERATIONS.md`).
- [ ] Migrations applied with `bun run db:deploy`; `bun run test` green against a real
      `TEST_DATABASE_URL`.
- [ ] One end-to-end test in dry run: import → draft → approve → stored as sent.
- [ ] Auto-send off for the first live days. Approve drafts by hand.
- [ ] Then `DRY_RUN="false"` on API and agent, restart, and send one text to your own
      phone. Reply STOP and confirm the suppression.
