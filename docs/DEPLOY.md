# Deploy to the public internet

Recommended path: **Vercel Pro (one project, three services) + Neon Postgres + one custom domain.**
Cost: about $20 per month (Vercel Pro) + $0–5 (Neon) + about $12 per year (domain) + Anthropic usage.

Legend: **[HUMAN]** needs your account, money or a secret. **[GOD]** an agent or script with repo access can run it.

## 1. Why this host

| | Vercel Pro + Neon (recommended) | Railway (api + agent + Postgres) + Vercel (app) |
| --- | --- | --- |
| Cost | $20 + $0–5 | About $5 + usage per service, + Vercel Hobby (free, personal use only) |
| Setup effort | Lowest. One project, one `vercel.json`. | Medium. Own the Dockerfile, volume and 5 cron callers. |
| eve agent | Native: Vercel Workflow, Cron, Sandbox. | `eve start` needs a persistent volume. One instance only. |
| API crons | Built in (root `vercel.json`). | None. |

Why Pro: the agent runs a schedule every minute (`apps/agent/agent/schedules/dispatch.ts`) and the API syncs mail every 5 minutes. Vercel Hobby runs a cron at most once a day.

Why one domain: all services sit behind one public origin. Cookies, CORS and the OAuth redirect URI need no extra settings. Do not set `AUTH_COOKIE_DOMAIN`.

## 2. How the pieces connect

One Vercel project, one repo-root `vercel.json`, three **services**: `app`, `api`, `agent`. A service is private unless a top-level rewrite points at it.

| Public path | Service |
| --- | --- |
| `/webhooks/telnyx` | `api` (Telnyx posts here) |
| `/leads/ingest` | `api` (web forms post here) |
| `/internal/sync/mailboxes`, `/internal/sync/rates`, `/internal/telemetry/rollup`, `/internal/tracking/retention`, `/internal/archive/prune` | `api` (Vercel Cron calls these. Each needs `Authorization: Bearer $CRON_SECRET`.) |
| everything else (`/`, `/api/auth/*`, `/api/trpc`, `/api/t/*`, `/eve/v1/*`) | `app` |

- Browser → **app** only. The app proxies `/api/*` to the API and `/eve/v1/*` to the agent.
- `/internal/sms`, `/internal/calendar` and `/health` stay private.

| Caller | Target | Binding variable |
| --- | --- | --- |
| `app` | `api` | `API_INTERNAL_URL` |
| `app` | `agent` | `AGENT_URL` |
| `api` | `agent` | `AGENT_URL` |
| `agent` | `api` | `API_INTERNAL_URL` |

Vercel injects the binding variables at runtime, in functions only. Do not set them. They do not exist at build time or in `apps/app/proxy.ts`. The proxy reads `API_URL`, the public origin, so it needs no binding.

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

## 6. Create the Vercel project [HUMAN]

Vercel → Add New → Project → import `wmsprinkle/insurance-sms-crm` **once**.

| Setting | Value |
| --- | --- |
| Root Directory | Repo root (leave empty) |
| Framework preset | Services (Vercel reads the root `vercel.json`) |
| Node.js | 24.x (the agent needs it) |
| Build, Install, Output | Leave empty. Each service sets its own in `vercel.json`. |

Add your domain: Project → Settings → Domains. Use the apex or one host, for example `crm.<domain>`.

Turn **Deployment Protection** off for production (Settings → Deployment Protection). Telnyx and Vercel Cron cannot pass a Vercel login.

Set the variables in section 7 **before** the first deploy.

## 7. Environment variables

Set each for **Production**, project-wide. Never set `DEV_LOGIN`. `NODE_ENV` is `production` on Vercel by itself. Never set `API_INTERNAL_URL` or `AGENT_URL`: bindings inject them.

Let `<domain>` = the single public host, for example `https://crm.example.com`.

### Shared and public values

| Variable | Value | Source |
| --- | --- | --- |
| `API_URL` | `<domain>` | You choose |
| `APP_URL` | `<domain>` (same value) | You choose |
| `NEXT_PUBLIC_API_URL` | Leave unset. `next.config.ts` copies `API_URL`. | |
| `AUTH_COOKIE_DOMAIN` | Leave unset. | |
| `DATABASE_URL` | Neon pooled string | Neon [HUMAN] |
| `DIRECT_DATABASE_URL` | Neon direct string | Neon |
| `BETTER_AUTH_SECRET` | 32+ random characters | Section 4 |
| `AGENT_BRIDGE_SECRET` | 32+ random characters | Section 4 |
| `CRON_SECRET` | 16+ random characters. Vercel Cron sends it as a Bearer token. | Section 4 |
| `DRY_RUN` | `true` until Telnyx is verified, then `false` | You choose |
| `ALLOWED_SIGN_IN` | Your email, or `a@x.com,b@x.com` | You choose |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client | Google Cloud, `docs/OAUTH_SETUP.md` |

### API

| Variable | Value | Source |
| --- | --- | --- |
| `TELNYX_API_KEY` | API key | Telnyx Portal → API Keys |
| `TELNYX_MESSAGING_PROFILE_ID` | Profile id | Telnyx Portal → Messaging |
| `TELNYX_FROM_NUMBER` | `+1…` E.164 | Telnyx Portal → Numbers |
| `TELNYX_PUBLIC_KEY` | Base64 key | Telnyx Portal → Keys & Credentials → Public Key |
| `LEAD_INGEST_SECRETS` | Optional. `webform:<16+ chars>` | You choose |
| `REDIS_URL` | Optional. Needed only for website tracking. | Upstash via Vercel Marketplace |
| `BLOB_READ_WRITE_TOKEN` | Optional. Logos and avatars. | Vercel → Storage → Blob |
| `CRM_TELEMETRY_DISABLED` | Optional. `1` turns off anonymous telemetry. | You choose |

The API refuses to boot in production if: no Google or Microsoft pair, `API_URL` or `APP_URL` is not https or is localhost, `AGENT_URL` is set with a short `AGENT_BRIDGE_SECRET`, or `DRY_RUN=false` lacks `TELNYX_API_KEY` or `TELNYX_PUBLIC_KEY`. Do not weaken these checks.

### Agent

| Variable | Value | Source |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | `sk-ant-…` | https://console.anthropic.com |
| `ANTHROPIC_WORKSPACE_ID` | Only for a key not scoped to a workspace | Anthropic console |
| `BLOB_READ_WRITE_TOKEN`, `PERPLEXITY_API_KEY`, `GITHUB_TOKEN` | Optional | See `.env.example` |

Leave `IS_MARKETING` unset. With `ANTHROPIC_API_KEY` set, the agent calls Claude direct. The agent holds no Telnyx keys. The API sends the SMS.

## 8. Deploy [HUMAN clicks, GOD can run the CLI]

1. [GOD] Push: `git push -u origin main`. The repo pre-push gate runs check-types, lint, lint:slop. See god memory for the `.env` move-aside recipe.
2. [HUMAN] Vercel builds the three services on each push to `main`. The `api` build runs migrations on production.
3. [HUMAN] Google Cloud → Credentials → your OAuth client:
   - Authorized JavaScript origin: `<domain>`
   - Authorized redirect URI: `<domain>/api/auth/callback/google`
4. [HUMAN] Telnyx Portal → Messaging → your profile → inbound webhook URL: `<domain>/webhooks/telnyx`. Paste the public key into `TELNYX_PUBLIC_KEY`, then redeploy.

## 9. Post-deploy checklist

- [ ] Vercel → Project → Settings → Services lists `app`, `api`, `agent`. Only the paths in section 2 are public. [HUMAN]
- [ ] `curl -i <domain>/api/auth/ok` returns 200. This proves app → api. [GOD]
- [ ] `curl -i <domain>/internal/sync/mailboxes` returns 403 (no secret) or 503 (`CRON_SECRET` unset). Never 200. [GOD]
- [ ] `curl -i <domain>/internal/sms/send` returns 404 (private). [GOD]
- [ ] Vercel → Settings → Cron Jobs lists the **5** API jobs and the agent `dispatch` schedule. [HUMAN]
- [ ] Open `<domain>/sign-in`. Sign in with Google. You land in the workspace. [HUMAN]
- [ ] Open a contact → Agent tab. No 401, 502 or 503. (401 = secrets differ. 502 = agent binding broken. 503 = secret unset.) [HUMAN]
- [ ] Settings → Today → Get started shows `<domain>/webhooks/telnyx`. [HUMAN]
- [ ] With `DRY_RUN=true`: import a lead. A draft appears within 2 minutes. This proves the agent cron and agent → api. [HUMAN]
- [ ] Send one real test SMS to your own phone, then reply. The reply appears in Inbox. [HUMAN]
- [ ] Only then set `DRY_RUN=false`. Redeploy. [HUMAN]
- [ ] Toll-free number verification is complete (`docs/TOLLFREE_VERIFICATION.md`). Carriers block unverified numbers. [HUMAN]

## 10. Rollback

- **Code:** Vercel → Project → Deployments → pick the last good deployment → ⋯ → **Instant Rollback**. 
- **Stop all texting at once:** set `DRY_RUN=true`, then redeploy.
- **Database:** migrations only go forward. Before you merge a change that adds a migration, make a Neon branch (Neon → Branches → Create) as a restore point. To restore, use Neon → Restore. Rolling back code does not roll back the schema.

## 11. Known limits

- Preview deployments share the production database (`docs/setup.md`). Do not test migrations on a preview.
- Only the `production` environment runs migrations.
- A Vercel Hobby plan breaks the agent queue. Use Pro.
- Google restricted scope `gmail.readonly` on an External consent screen needs Google verification for users outside your test list (`docs/setup.md`).
- Unverified at the time of writing: the exact `services` schema keys in `vercel.json` (`root`, `bindings`). Vercel rejected `crons` inside a service, so the 5 crons are top-level in `vercel.json`. Confirm against https://vercel.com/docs/services before the first deploy.
