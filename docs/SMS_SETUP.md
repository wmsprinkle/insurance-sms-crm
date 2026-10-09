# Insurance SMS CRM: setup

For the person who installs and runs the CRM. Daily use is in
[`OPERATIONS.md`](./OPERATIONS.md). The carrier paperwork is in
[`TOLLFREE_VERIFICATION.md`](./TOLLFREE_VERIFICATION.md). Deploying to Vercel is in
[`DEPLOY.md`](./DEPLOY.md). Sign-in providers are in [`OAUTH_SETUP.md`](./OAUTH_SETUP.md).

## 1. Prerequisites

| Tool | Version | Why |
| --- | --- | --- |
| [Bun](https://bun.com) | 1.3.x | Package manager and test runner. Use `bunx`, not `npx`. |
| Node.js | 22 or newer for the app and API; 24 or newer for the agent | eve refuses to start below 24. |
| Docker | any recent | Runs Postgres 17 from `docker-compose.yml`. |
| `openssl` | any | Generates secrets. |

## 2. Environment variables

There is one `.env`, at the repo root. The app, the API and the agent all read it. A real
environment variable wins over the file. `.env.example` documents every variable.

| Variable | Required | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection. |
| `DIRECT_DATABASE_URL` | Only with a pooler | Unpooled URL for `prisma migrate deploy`. |
| `TEST_DATABASE_URL` | For tests | A throwaway database. The name must end in `_test`. |
| `BETTER_AUTH_SECRET` | Yes | Session signing. `openssl rand -base64 32`. Same value in app and API. |
| `ALLOWED_SIGN_IN` | Yes | Who may get an account: email domains and single addresses, comma-separated. Empty means nobody. |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` | One sign-in method is needed | Auth0 sign-in. Set all three or none. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For booking | Google sign-in and Google Calendar. Set both or neither. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | No | Microsoft sign-in. Microsoft calendars are not used for booking. |
| `API_URL` | Off localhost, and always for the agent | API origin. Default `http://localhost:3001`. |
| `APP_URL` | Off localhost | App origin. Default `http://localhost:3000`. |
| `AUTH_COOKIE_DOMAIN` | Only on split subdomains | Parent domain such as `.example.com`. |
| `AGENT_URL` | For the Agent tab | Agent origin. Locally `http://127.0.0.1:2000`. |
| `AGENT_BRIDGE_SECRET` | Yes for SMS | See section 6. |
| `AI_GATEWAY_API_KEY` | Off Vercel, unless `ANTHROPIC_API_KEY` is set | Model access. See section 8. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` | No | Call Anthropic directly instead of the Gateway. |
| `TELNYX_API_KEY` | To send | Telnyx Portal, API Keys. |
| `TELNYX_MESSAGING_PROFILE_ID` | To send | The messaging profile that owns the number. |
| `TELNYX_FROM_NUMBER` | To send | The verified toll-free number in E.164, for example `+18005550100`. |
| `TELNYX_PUBLIC_KEY` | To receive | Telnyx Portal, Keys and Credentials, Public Key (base64). Without it `POST /webhooks/telnyx` answers 503. |
| `TELNYX_MPS` | No | Messages per second per number. Default 1. |
| `LEAD_INGEST_SECRETS` | For the lead webhook | See section 7. |
| `CRON_SECRET` | For scheduled jobs | Bearer token for the cron endpoints. At least 16 characters. |
| `REDIS_URL`, `CACHE_TTL_MS` | No | Shared cache. Without Redis each instance caches in memory. |
| `BLOB_READ_WRITE_TOKEN` | No | Vercel Blob. |

The API declares its variables in `apps/api/src/config/env.validation.ts`. Turbo runs with
strict env, so a variable must also be in `globalPassThroughEnv` in `turbo.json`.

## 3. Run it on your machine

```sh
cp .env.example .env
# Set BETTER_AUTH_SECRET, ALLOWED_SIGN_IN and one sign-in method.
# Also set: API_URL, AGENT_URL, AGENT_BRIDGE_SECRET and AI_GATEWAY_API_KEY.
bun install
docker compose up -d
bun run db:migrate && bun run db:seed
bun run dev            # app :3000, api :3001, agent :2000
```

Then:

1. Open `http://localhost:3000` and sign in. The first sign-in creates the workspace.
   Rename it in **Settings, General**.
2. Check **Today, Get started**. It shows the Telnyx number (masked), whether the model
   key is set and the exact webhook URL to paste into Telnyx.
3. Go to **Settings, Compliance**. Set the business name, the licensed states and the
   first message. Leave **Auto-send first messages** off for the first test.
4. Go to **Leads, Import**. Upload [`sample-leads.csv`](./sample-leads.csv). Accept the
   suggested column mapping. Check the preview, then import.
5. Each new lead gets one first-touch task, due at the next allowed send time. Outside
   8:00 to 21:00 local time (stricter in some states) the task waits.
6. Texting starts paused. While it is paused, nothing leaves the system: each message is
   stored as if it went out. Turn texting on under **Settings, Compliance, Texting** only
   when Telnyx is set up and verified.

Notes:

- **eve needs Node 24 or newer.** On macOS: `brew install node@24`.
- **The agent runs in an interactive terminal UI.** Select its pane and press Enter, or run
  `turbo run dev:headless --filter=agent`.
- **Replies need a model credential.** Without one, first texts still go out, but a reply
  from a lead cannot be answered. The lead shows **Needs you**.

## 4. Connect Telnyx

Do this only after the toll-free number is verified. Unverified toll-free numbers cannot
send. See [`TOLLFREE_VERIFICATION.md`](./TOLLFREE_VERIFICATION.md).

1. **Messaging profile.** Telnyx Portal, Messaging. Create a profile. Copy its id into
   `TELNYX_MESSAGING_PROFILE_ID`.
2. **Toll-free number.** Buy a number and assign it to that profile. Put it in E.164 in
   `TELNYX_FROM_NUMBER`. One toll-free number carries one use case.
3. **Webhook URL.** On the profile, set the inbound webhook URL to
   `https://<your-api-host>/webhooks/telnyx`. This is the API origin, not the app.
4. **Public key.** Copy the base64 public key into `TELNYX_PUBLIC_KEY`. The API checks the
   Ed25519 signature and refuses events older than 300 seconds.
5. **API key.** Put it in `TELNYX_API_KEY`.
6. **Start texting.** An owner or an admin turns on **Settings, Compliance, Texting**. The
   switch stays off until the API key, the number and the public key are all set.

Telnyx retries a webhook that does not answer in about 2 seconds. The controller only
verifies, stores and queues a task, so it answers fast. A retry with the same message id is
stored once.

## 5. Google OAuth for calendar booking

1. Google Cloud console, Credentials, OAuth client ID, Web application.
2. Authorised redirect URIs: `http://localhost:3001/api/auth/callback/google` and, in
   production, `https://<your-api-host>/api/auth/callback/google`.
3. Enable the **Gmail API** and the **Google Calendar API** on the project.
4. On the consent screen, add the scopes the app requests:
   - `openid`, `email`, `profile`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.freebusy`
   - `https://www.googleapis.com/auth/gmail.readonly`
5. On Google Workspace, set **User type: Internal**. `gmail.readonly` is a restricted
   scope, so an External app needs Google verification. While an External app is in
   Testing, add every user under **Test users**.
6. Copy the client id and secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

If Google sign-in fails or loops, check these in order: the Calendar API and the Gmail API
are enabled, every scope above is on the consent screen, the user is a test user or the app
is Internal, and the person ticked every permission box on the consent page. Google lets a
person untick a scope and still sign in. The CRM then sends them to **Grant access**.

A Google account connected before the booking scopes existed keeps working but cannot book.
**Settings, Connections** shows **Grant calendar access** for that account.

## 6. `AGENT_BRIDGE_SECRET`

One shared secret, the same value in the app, the API and the agent.

```sh
openssl rand -base64 32
```

It authorises the agent to API calls (`POST /internal/sms/send` and
`POST /internal/calendar/book`), the app to agent proxy behind the contact **Agent** tab,
and the API to agent dispatch poke. Unset on the API: the internal routes answer 503.
Unset on the agent: it cannot send, and every text becomes a draft. Different values: 401.

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
| `x-lead-signature` | `sha256=` and the hex HMAC-SHA256 of `"<timestamp>.<raw body>"` with the secret. |

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
`optInText` or `optInUrl` is required. Answers: 200 `created` or `duplicate`, 422 `rejected`
with reasons, 400 bad JSON, 401 bad signature or timestamp, 413 too large, 503 secrets not
set.

## 8. Model access

The agent reaches its model through the Vercel AI Gateway, or directly through Anthropic.

- On Vercel, OIDC handles authentication. Set nothing.
- Elsewhere, set `AI_GATEWAY_API_KEY`.
- Set `ANTHROPIC_API_KEY` to call Anthropic directly. The Gateway is not used while it is
  set. `ANTHROPIC_WORKSPACE_ID` is for a key that is not scoped to a workspace.
- The model is a setting, not a variable. An owner or an admin chooses it in **Settings**.

Without a credential, first texts still go out because they use no model. Replies to
inbound texts fail at the model turn.

## 9. Deploy shape

Three deployments and one Postgres.

| Deployment | Code | Needs |
| --- | --- | --- |
| App (Next.js) | `apps/app` | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `API_URL`, `APP_URL`, `AGENT_URL`, `AGENT_BRIDGE_SECRET` |
| API (NestJS) | `apps/api` | Everything in section 2 that the API declares |
| Agent (eve) | `apps/agent` | `DATABASE_URL`, `API_URL`, `AGENT_BRIDGE_SECRET`, `AI_GATEWAY_API_KEY` (off Vercel) |

- `DATABASE_URL` and `BETTER_AUTH_SECRET` must match across deployments. A mismatch is a
  sign-in redirect loop.
- The agent drains its task queue once a minute from its own schedule.
- The Telnyx webhook and the lead webhook point at the API origin.
- Migrations run with `bun run db:deploy`, and on a production deploy.

## 10. Going-live checklist

- [ ] Toll-free verification is approved for the number in `TELNYX_FROM_NUMBER`.
- [ ] The opt-in page, privacy policy and terms are public.
- [ ] Every imported lead has a consent source, a capture time and opt-in text or a URL.
      No purchased or third-party leads.
- [ ] A lawyer has reviewed the quiet-hours table in
      `apps/api/src/compliance/compliance-config.ts`.
- [ ] The business name on **Settings, Compliance** equals the name on the verification form.
- [ ] The licensed states are set.
- [ ] The knowledge files are reviewed for your lines of insurance: no prices, no promises.
- [ ] The first message matches the sample message submitted for verification.
- [ ] `AGENT_BRIDGE_SECRET` is identical in the app, the API and the agent.
- [ ] A Google account is connected with the booking scopes.
- [ ] The calendar owner and the fallback booking link are set.
- [ ] Migrations are applied, and the tests pass against a real `TEST_DATABASE_URL`.
- [ ] Auto-send is off for the first live days. Approve drafts by hand.
- [ ] Turn on **Texting**. Send one text to your own phone. Reply STOP and confirm the
      suppression.
