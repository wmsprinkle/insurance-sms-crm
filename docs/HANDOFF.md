# Handoff — Insurance SMS CRM

One page for the person who takes this over. Details: [`SMS_SETUP.md`](./SMS_SETUP.md), [`OAUTH_SETUP.md`](./OAUTH_SETUP.md), [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md), [`OPERATIONS.md`](./OPERATIONS.md), [`QA_REPORT.md`](./QA_REPORT.md).

## What exists

A CRM (Next.js app, NestJS API, eve agent, one Postgres) that texts insurance leads.

- **Import.** A CSV or the lead webhook creates contacts. A lead without a consent source and time is rejected.
- **First touch.** Each lead gets one text at the next allowed send window. The window follows the lead's state and area code.
- **Replies.** Telnyx webhooks store each inbound text. The agent qualifies the lead, offers call times and books a call on Google Calendar. It texts a confirmation.
- **Safety.** STOP, free-text opt-outs ("please stop") and wrong-number replies suppress the number without a model turn. Consent is tied to the phone number. A frequency cap of 3 a day and 7 a week applies until the lead answers. An unknown Telnyx outcome blocks a second send.
- **Drafts and hand-offs.** With auto-send off, every text waits in **Inbox → Drafts** for a person. A person can take over a conversation.
- **Settings** (**Settings → Compliance**, owner or admin only): business name, first message, disclosure mode, auto-send, licensed states, calendar owner, fallback booking link. The frequency cap and the quiet-hours table are read-only.

Tested in this sandbox: unit tests, PGlite integration tests and two end-to-end tests (1,922 pass). Not tested: anything with a real Postgres, Telnyx, Google or model key. See `QA_REPORT.md` → "NOT verified".

## Start it locally in dry run

Dry run sends nothing. Telnyx gets no call. Texts are stored with an id `dryrun-…`.

```sh
cp .env.example .env
# Set BETTER_AUTH_SECRET, ALLOWED_SIGN_IN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
# Add: DRY_RUN="true", API_URL="http://localhost:3001",
#      AGENT_URL="http://127.0.0.1:2000", AGENT_BRIDGE_SECRET="<openssl rand -base64 32>"
# Add AI_GATEWAY_API_KEY only for model replies.
bun install
docker compose up -d      # Postgres on :5432
bun run db:deploy
bun run dev               # app :3000, API :3001, agent :2000
```

Then sign in at `http://localhost:3000`, open **Settings → Compliance**, leave auto-send off, import `docs/sample-leads.csv` and approve the first message in **Inbox → Drafts**. Inbound texts cannot be simulated from the UI.

## What only you can do, in order

### Accounts

1. **Telnyx account.** Create a messaging profile. Buy one toll-free number and assign it to the profile. Set `TELNYX_API_KEY`, `TELNYX_MESSAGING_PROFILE_ID`, `TELNYX_FROM_NUMBER` and `TELNYX_PUBLIC_KEY`.
2. **Toll-free verification.** Fill and submit [`TOLLFREE_VERIFICATION.md`](./TOLLFREE_VERIFICATION.md). Publish the opt-in page, privacy policy and terms first. Wait for approval. Unverified numbers cannot send.
3. **Google OAuth.** Follow [`OAUTH_SETUP.md`](./OAUTH_SETUP.md). Create a Google Cloud OAuth client with the Gmail and Calendar APIs and the three booking scopes. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Connect one Google account in **Settings → Connections**. Click **Grant calendar access** if it shows.
4. **Model key.** Set `AI_GATEWAY_API_KEY` (or the Vercel AI Gateway on Vercel). Without it the agent drafts nothing useful.
5. **Hosting.** Three deployments (app, API, agent) and one Postgres. Run exactly one API instance that sends (the rate limiter is per process). Set the same `DATABASE_URL`, `BETTER_AUTH_SECRET` and `AGENT_BRIDGE_SECRET` everywhere. Point the Telnyx webhook at `https://<api-host>/webhooks/telnyx`.
6. **Real database run.** Run `bun run db:deploy`, then `bun run test` with a real `TEST_DATABASE_URL`. Check for duplicate active phones first (migration `20261003140000` fails on them). Run the consent backfill check from `BUILD_STATUS.md` (fix round 2, N4) on production data.
7. **Model evals.** Run `eve eval` in staging. No eval has run.

### Decisions

1. **Lead consent source.** Decide where each lead's consent comes from (web form, your own opt-in page, a phone recording). No purchased or third-party affiliate leads. Every row needs a source, a capture time and opt-in text or a URL.
2. **Lines and states.** Decide the lines of insurance and review the `knowledge-*.md` files in `apps/agent/agent/skills` (no prices, no promises). Set **Licensed states** and **Business name**. The name must equal the name on the verification form.
3. **Disclosure mode.** Choose `disclose` (default) or `deflect`. Some states require disclosure.
4. **Calendar owner.** Pick whose calendar receives bookings. Set a fallback booking link or accept a hand-off to a person.

### Legal review

1. Get a lawyer to review the per-state quiet-hours table (`apps/api/src/compliance/compliance-config.ts`, shown on **Settings → Compliance**).
2. Get counsel's answer on the open items in [`COMPLIANCE_RECHECK.md`](./COMPLIANCE_RECHECK.md) and the first-message text.

### Go live

Follow the checklist in `SMS_SETUP.md` section 10. Keep auto-send off for the first live days. Set `DRY_RUN="false"` last. Send one text to your own phone, reply STOP and confirm the suppression.

## Top residual risks

The re-review in `COMPLIANCE_RECHECK.md` found 8 open items. Round 2 fixed R2 to R7 in code. What is left:

1. **eve lockdown is not proven in the runtime (R1, High).** Each CRM tool refuses an SMS session on its own, and a test proves it. Nobody ran the real eve runtime. Durable step replay and subagent routing are unknown. Effect: a missed prompt injection could reach a CRM tool. Action: run `eve eval` with an injection case in staging.
2. **Unknown send outcome needs a person (R3).** After a Telnyx timeout the receipt stays `unknown`. No alert fires. A person must check Telnyx, then discard the draft and send again. Action: watch for the log line `SMS send outcome unknown`.
3. **Frequency cap race under parallel sends (R4).** The gate counts in-flight sends. It is not proven with parallel database connections. Effect: at most one extra text in a burst. Action: test on a real Postgres.
4. **Opt-out phrase list is a keyword rule (R2).** It covers common wording. Odd phrasing reaches the model, and the model's `classify_reply` is the backup. A short message with the word "stop" suppresses the number. A person lifts it with START.
5. **Prompt-injection filters have gaps (N5).** Obfuscated links ("evil dot com") and free-text names pass the outbound guard. The lockdown is the real control.
6. **Canadian `+1` numbers pass the US gate (N6).** CASL is not modelled. Action: do not import Canadian leads.
7. **Backfill assumption (N4).** Migration `20261003170000` gives old consent to a phone edited before the migration. Action: run the check before deploy.
8. **A purge does not suppress the phone.** The consent rows and the audit trail stay, but a purged number can be texted again if a new import brings consent. Decide with counsel.
