# Web and API security audit

Date: 2026-10-03. Owner: worker-crm-websec. Base: `main` at `26d92eb` before the fixes.
Scope: sign-in, sessions, HTTP surface, headers, webhooks, internal bridges, authorization, imports, XSS, SSRF, logs, agent abuse, cost, dependencies, boot checks.
Not repeated: [`COMPLIANCE_SECURITY_REVIEW.md`](./COMPLIANCE_SECURITY_REVIEW.md), [`COMPLIANCE_RECHECK.md`](./COMPLIANCE_RECHECK.md), [`QA_REPORT.md`](./QA_REPORT.md).
Method: code reading, two read-only review passes, `bun audit`, unit and PGlite specs. No live server, no browser, no real Telnyx or model call.
Sign-in setup: [`OAUTH_SETUP.md`](./OAUTH_SETUP.md).

## Summary

| Status | Count |
|---|---|
| Fixed, with a test | 9 |
| Accepted risk | 6 |
| Needs human | 3 |

## Findings

| Id | Severity | Status | Finding |
|---|---|---|---|
| A1 | High | Fixed | Google and Microsoft were trusted for account linking. An unverified Microsoft email could take over an account. |
| A2 | High | Fixed | The allow-list ran only when a user row was created. A removed address kept signing in. A provider could return an unverified email. |
| A3 | Medium | Fixed | The sign-in page showed Google even when it was not configured. |
| B1 | Medium | Fixed | Production booted with no OAuth, http URLs, short bridge secrets, or live sending without Telnyx keys. |
| B2 | Medium | Fixed | The app sent no frame, sniffing, referrer, permissions or HSTS headers. Clickjacking of draft approval was possible. |
| B3 | Medium | Fixed | Meeting, brief, social and website links went to `href` unchecked. A `javascript:` link ran in the CRM origin on click. |
| B4 | Medium | Fixed | Logs held the full URL. Share tokens and tRPC inputs (phone numbers) reached the log. |
| B5 | Medium | Fixed | Inbound SMS text had no length cap at ingest. A 256 KB text was stored and scanned. |
| B6 | Low | Fixed | The agent logged tool input (message text) whenever `NODE_ENV` was not `production`. It is now opt-in with `AGENT_LOG_CONTENT=1`. |
| N1 | Critical | **Needs human** | `next` 16.3.0 has three remote code execution advisories (fixed in 16.3.6). AVIF is now off, which closes one path. The upgrade is not done. |
| N2 | High | **Needs human** | `multer` below 2.3.0 has denial-of-service advisories. It comes with the Nest platform package. |
| N3 | High | **Needs human** | `bun audit` reports 98 advisories (4 critical, 42 high). Most are build-tool or transitive. Triage after N1 and N2. |
| R1 | Medium | Accepted | No inbound rate limit on public routes (`/webhooks/telnyx`, `/leads/ingest`, `/internal/*`, `/api/t`). Every route checks a signature or secret first. Add a limit at the reverse proxy. |
| R2 | Medium | Accepted | `/internal/*` routes check a bearer secret but not the source address. The agent runs as a separate deployment, so loopback-only would break it. The 32-character minimum now applies. |
| R3 | Medium | Accepted | A lead can text many times. The model is capped (4 turns an hour, 8 in total per lead). Each inbound still makes a task row. A hand-off does not stop the rows. There is no per-workspace daily model cap. |
| R4 | Low | Accepted | The SMS tool lockdown is a deny-list. See `COMPLIANCE_RECHECK.md` R1. Needs an `eve eval`. |
| R5 | Low | Accepted | `AGENT_BRIDGE_SECRET` also signs the eve user token. Use one secret, 32 characters or more. |
| R6 | Low | Accepted | The SSRF guard resolves DNS and then fetches. A rebinding DNS server can pass the check. Pin the address with a custom dispatcher. SSO issuer discovery does not use the guard (admin only). |
| R7 | Low | Accepted | The `/eve` proxy returns the upstream error text on a 502. |
| R8 | Low | Accepted | The Next app has no nonce-based Content-Security-Policy. It sends `frame-ancestors`, `base-uri`, `object-src` and `form-action`. No script policy is set. |

## Checked and sound

- **Cookies.** Better Auth sets the prefix, `HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production` (`packages/auth/src/auth.ts`). Session life is 30 days, renewed daily while in use.
- **CSRF.** Better Auth checks the origin against `trustedOrigins`. No CORS is enabled, so a cross-site page cannot read or send JSON with cookies.
- **Telnyx webhook.** Ed25519 check, 5-minute window, 256 KiB body cap, unique `telnyxId`. It answers 503 with no key.
- **Bridges.** Both use `timingSafeEqual` and fail closed on an empty secret.
- **tRPC.** A mutation with no `PROCEDURE_ROLES` entry is refused. Turning texting on or off needs an owner or an admin.
- **CSV.** Import limits: 5 MiB, 5,000 rows, 100 columns. The product has no CSV export, so no formula-injection sink exists.
- **XSS.** No `dangerouslySetInnerHTML` or HTML sink. SMS text renders as React text.
- **Open redirect.** All callbacks come from `window.location.origin`.
- **Secrets.** The only `NEXT_PUBLIC_` variable is the API URL.
- **better-auth.** Version 1.6.25 is installed for the app. The older 1.4.22 copy comes only from the `@better-auth/cli` dev tool.
- **DB.** `smsMessage.telnyxId` is unique. Receipts use the event id as the claim. The test database must end in `_test`.

## Fix map

| Id | Commit | Test |
|---|---|---|
| A1, A2, A3 | `139378a`, `e066e56` | `packages/auth/test/sign-in-policy.spec.ts` |
| B1 | `092c471` | `apps/api/test/env-production.spec.ts`, `src/config/env.validation.spec.ts` |
| B2 | `a42a83c` | `apps/app/lib/security-headers.test.ts` |
| B3 | `799b647` | `apps/app/lib/safe-url.test.ts` |
| B4 | `93b31d5` | `apps/api/test/logging-path.spec.ts` |
| B5, B6 | `3795aa5` | `apps/api/test/sms-telnyx-webhook.spec.ts` |

## Residual risks and next steps

1. Upgrade `next` to 16.3.6 or later and `multer` to 2.3.0 or later. Run `bun audit` again. Run the app build.
2. Put a rate limit in front of the API (per IP on `/webhooks`, `/leads/ingest`, `/api/t`). Block `/internal/*` at the proxy from the public internet.
3. Run `eve eval` with an injection case in staging.
4. Add a nonce-based script policy when the app is public.
5. A real browser pass is still owed: sign-in, headers in the response, link rendering.
