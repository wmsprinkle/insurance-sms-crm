# Deploy to the public internet

Recommended path: **Vercel Pro (three projects) + Neon Postgres + one custom domain.**
Cost: about $20 per month (Vercel Pro) + $0–5 (Neon) + about $12 per year (domain) + Anthropic usage.

Legend: **[HUMAN]** needs your account, money or a secret. **[GOD]** an agent or script with repo access can run it.

## 1. Why this host

| | Vercel Pro + Neon (recommended) | Railway (api + agent + Postgres) + Vercel (app) | Render or Fly (api + agent + Postgres) + Vercel (app) |
| --- | --- | --- | --- |
| Cost | $20 + $0–5 | About $5 + usage per service, + Vercel Hobby (free, personal use only) | About $7–15 per service, + Vercel |
| Setup effort | Lowest. Repo is built for it. | Medium. Own the Dockerfile, volume and 5 cron callers. | Highest. |
| eve agent | Native: Vercel Workflow, Cron, Sandbox. No disk to manage. | `eve start` needs a persistent volume for `.eve/.workflow-data`. One instance only. | Same as Railway. |
| API crons | Built in (`apps/api/vercel.json`). | None. Needs an outside caller for 5 routes. | None. Same. |
| Main risk | Pro plan is required. | Workflow state lives on one disk. | Same. |

Why Pro: the agent runs a schedule every minute (`apps/agent/agent/schedules/dispatch.ts`) and the API syncs mail every 5 minutes. Vercel Hobby runs a cron at most once a day. On Hobby the agent queue stops draining.

Why a custom domain: the sign-in cookie must cover the app host and the API host. A `*.vercel.app` host cannot share a cookie. Use `app.<domain>`, `api.<domain>`, `agent.<domain>` with `AUTH_COOKIE_DOMAIN=.<domain>`.

## 2. How the pieces connect

- Browser → **app** only. The app proxies `/api/*` to the API (`apps/app/app/api/[...path]/route.ts`) and `/eve/v1/*` to the agent. There is no CORS config and none is needed.
- Google redirects the browser to the **API** (`<API_URL>/api/auth/callback/google`). The API sets the session cookie on `.<domain>`.
- Telnyx posts to the **API** (`/webhooks/telnyx`).
- The agent reads and writes Postgres directly and calls the API at `API_URL`.
- The API pokes the agent at `AGENT_URL`. Both use `AGENT_BRIDGE_SECRET`.
- Vercel Cron calls the API crons and the agent schedule with `Authorization: Bearer $CRON_SECRET` (API).

## 3. Accounts to create [HUMAN]

1. Vercel account, upgraded to **Pro**: https://vercel.com/account/billing
2. GitHub: the repo `wmsprinkle/insurance-sms-crm` must be pushed by god (`git push -u origin main`). Connect it to Vercel.
3. Neon (create it from Vercel: Storage → Create Database → Neon) or https://neon.tech
4. A domain from any registrar. Add it in Vercel: Domains.
5. Existing accounts you already have: Google Cloud (OAuth client), Telnyx, Anthropic.

## 4. Generate secrets [HUMAN or GOD]

```sh
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # AGENT_BRIDGE_SECRET (must be 32+ characters)
openssl rand -base64 24   # CRON_SECRET (16+ characters)
```

Keep one copy in a password manager. Never paste a secret into chat, git or a doc.

## 5. Database [HUMAN]

1. Neon project → region near `iad1` (US East). Copy two strings:
   - **Pooled** string (host contains `-pooler`) → `DATABASE_URL`.
   - **Direct** string (no `-pooler`) → `DIRECT_DATABASE_URL`.
2. Add `?sslmode=require` if the string lacks it.

Migrations (61 of them) run by themselves on every **production** build of the API (`apps/api/scripts/build-func.mjs`, using `DIRECT_DATABASE_URL`). The build then compares the live schema with `schema.prisma` and prints a loud warning on drift.

Manual command, if you need it (run from your laptop, once):

```sh
cd packages/db && DATABASE_URL="<DIRECT string>" bunx prisma migrate deploy
```

Do not run `db:push`, `db:reset` or `db:seed` against this database.

## 6. Create the three Vercel projects [HUMAN]

Vercel → Add New → Project → import `wmsprinkle/insurance-sms-crm` three times. Keep **Include source files outside of the Root Directory** on (default).

| Project name | Root Directory | Framework preset | Node.js | Extra settings |
| --- | --- | --- | --- | --- |
| `crm-api` | `apps/api` | Other | 22.x | Build Command: `node scripts/build-func.mjs`. Install Command: `cd ../.. && bun install --frozen-lockfile`. Output Directory: leave empty. |
| `crm-app` | `apps/app` | Next.js | 22.x | Defaults. |
| `crm-agent` | `apps/agent` | Other | **24.x** | Defaults. eve detects Vercel and writes `.vercel/output`. |

Domains (Project → Settings → Domains): `api.<domain>` → crm-api, `app.<domain>` → crm-app, `agent.<domain>` → crm-agent.

Turn **Deployment Protection** off for production on crm-api and crm-agent (Settings → Deployment Protection). Telnyx and the other services cannot pass a Vercel login.

Set the environment variables in section 7 **before** the first deploy. `NEXT_PUBLIC_API_URL` is baked into the app at build time. If you change it, redeploy the app.

## 7. Environment variables

Use Vercel → Team Settings → Environment Variables to share a value between projects. Set each for **Production**. Never set `DEV_LOGIN`. `NODE_ENV` is `production` on Vercel by itself.

Let `<domain>` = your domain.

### Shared values (same in all three projects)

| Variable | Value | Source |
| --- | --- | --- |
| `DATABASE_URL` | Neon pooled string | Neon [HUMAN] |
| `BETTER_AUTH_SECRET` | 32+ random characters | Section 4 |
| `AGENT_BRIDGE_SECRET` | 32+ random characters | Section 4 |
| `API_URL` | `https://api.<domain>` | You choose |
| `DRY_RUN` | `true` until Telnyx is verified, then `false` | You choose |

### crm-api

| Variable | Value | Source |
| --- | --- | --- |
| `DIRECT_DATABASE_URL` | Neon direct string | Neon |
| `APP_URL` | `https://app.<domain>` | You choose |
| `AUTH_COOKIE_DOMAIN` | `.<domain>` | You choose |
| `ALLOWED_SIGN_IN` | Your email, or `a@x.com,b@x.com` | You choose |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client | Google Cloud, `docs/OAUTH_SETUP.md` |
| `AGENT_URL` | `https://agent.<domain>` | You choose |
| `CRON_SECRET` | 16+ random characters | Section 4 |
| `TELNYX_API_KEY` | API key | Telnyx Portal → API Keys |
| `TELNYX_MESSAGING_PROFILE_ID` | Profile id | Telnyx Portal → Messaging |
| `TELNYX_FROM_NUMBER` | `+1…` E.164 | Telnyx Portal → Numbers |
| `TELNYX_PUBLIC_KEY` | Base64 key | Telnyx Portal → Keys & Credentials → Public Key |
| `LEAD_INGEST_SECRETS` | Optional. `webform:<16+ chars>` | You choose |
| `REDIS_URL` | Optional. Needed only for website tracking. | Upstash via Vercel Marketplace |
| `BLOB_READ_WRITE_TOKEN` | Optional. Logos and avatars. | Vercel → Storage → Blob |
| `CRM_TELEMETRY_DISABLED` | Optional. `1` turns off anonymous telemetry. | You choose |

The API refuses to boot in production if: no Google or Microsoft pair, `API_URL` or `APP_URL` is not https or is localhost, `AGENT_URL` is set with a short `AGENT_BRIDGE_SECRET`, or `DRY_RUN=false` lacks `TELNYX_API_KEY` or `TELNYX_PUBLIC_KEY`. Do not weaken these checks.

### crm-app

| Variable | Value | Source |
| --- | --- | --- |
| `APP_URL` | `https://app.<domain>` | You choose |
| `NEXT_PUBLIC_API_URL` | `https://api.<domain>` (same as `API_URL`) | You choose |
| `AUTH_COOKIE_DOMAIN` | `.<domain>` | You choose |
| `ALLOWED_SIGN_IN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Same as the API | See above |
| `AGENT_URL` | `https://agent.<domain>` | You choose |

Leave `IS_MARKETING` unset.

### crm-agent

| Variable | Value | Source |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | https://console.anthropic.com |
| `ANTHROPIC_WORKSPACE_ID` | Only for a key not scoped to a workspace | Anthropic console |
| `BLOB_READ_WRITE_TOKEN`, `PERPLEXITY_API_KEY`, `GITHUB_TOKEN` | Optional | See `.env.example` |

With `ANTHROPIC_API_KEY` set, the agent calls Claude direct. The Vercel AI Gateway is not used.
The agent does not hold Telnyx keys. The API sends the SMS.

## 8. Deploy [HUMAN clicks, GOD can run the CLI]

1. [GOD] Push: `git push -u origin main`. The repo pre-push gate runs check-types, lint, lint:slop. See god memory for the `.env` move-aside recipe.
2. [HUMAN] Deploy in this order: **crm-api** (runs migrations), **crm-agent**, **crm-app**. Vercel deploys on each push to `main` after the first import.
3. [HUMAN] Google Cloud → Credentials → your OAuth client:
   - Authorized JavaScript origin: `https://app.<domain>`
   - Authorized redirect URI: `https://api.<domain>/api/auth/callback/google`
4. [HUMAN] Telnyx Portal → Messaging → your profile → inbound webhook URL: `https://api.<domain>/webhooks/telnyx`. Paste the public key into `TELNYX_PUBLIC_KEY`, then redeploy the API.

## 9. Post-deploy checklist

- [ ] `curl https://api.<domain>/health` returns `{"status":"ok","database":"up"}`. [GOD]
- [ ] `curl https://agent.<domain>/eve/v1/health` returns OK. [GOD]
- [ ] Vercel → crm-api → Settings → Cron Jobs lists **5** jobs (`/internal/sync/mailboxes`, `/internal/sync/rates`, `/internal/telemetry/rollup`, `/internal/tracking/retention`, `/internal/archive/prune`). [HUMAN]
- [ ] Vercel → crm-agent → Settings → Cron Jobs lists the `dispatch` schedule. [HUMAN]
- [ ] Open `https://app.<domain>/sign-in`. Sign in with Google. You land in the workspace. [HUMAN]
- [ ] Open a contact → Agent tab. No 401, 502 or 503. (401 = secrets differ. 502 = wrong `AGENT_URL`. 503 = secret unset.) [HUMAN]
- [ ] Settings → Today → Get started shows the webhook URL you set in Telnyx. [HUMAN]
- [ ] With `DRY_RUN=true`: import a lead. A draft appears within 2 minutes. This proves the agent cron runs. [HUMAN]
- [ ] Send one real test SMS to your own phone, then reply. The reply appears in Inbox. [HUMAN]
- [ ] Only then set `DRY_RUN=false` on crm-api and crm-agent. Redeploy both. [HUMAN]
- [ ] Toll-free number verification is complete (`docs/TOLLFREE_VERIFICATION.md`). Carriers block unverified numbers. [HUMAN]

## 10. Rollback

- **Code:** Vercel → Project → Deployments → pick the last good deployment → ⋯ → **Instant Rollback**. Do it per project.
- **Stop all texting at once:** set `DRY_RUN=true` on crm-api and crm-agent, then redeploy.
- **Database:** migrations only go forward. Before you merge a change that adds a migration, make a Neon branch (Neon → Branches → Create) as a restore point. To restore, use Neon → Restore. Rolling back code does not roll back the schema.

## 11. Known limits

- Preview deployments share the production database (`docs/setup.md`). Do not test migrations on a preview.
- Only the `production` environment runs migrations.
- A Vercel Hobby plan breaks the agent queue. Use Pro.
- Google restricted scope `gmail.readonly` on an External consent screen needs Google verification for users outside your test list (`docs/setup.md`).
