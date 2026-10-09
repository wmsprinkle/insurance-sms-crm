# OAuth sign-in setup

Sign-in is Google, Microsoft or Auth0, whichever you configure, through Better Auth. No password, email code or magic link exists. Nobody can sign in until you finish the steps below.

## What the code enforces

1. A provider must confirm the email address. An unverified email is refused.
2. `ALLOWED_SIGN_IN` is checked on every sign-in, after the provider answers. Remove an address and that person cannot start a new session.
3. Accounts never link by email alone. No provider is trusted for linking.
4. The sign-in page shows only the buttons you configured. With none, it shows "No way in yet".
5. In production the API refuses to boot with no OAuth credentials, a non-https `API_URL` or `APP_URL`, or a weak `AGENT_BRIDGE_SECRET`.
6. `DEV_LOGIN` signs in only requests that come straight from this machine to `localhost` or `127.0.0.1`. A request through a proxy or tunnel is refused. See "Local development".

## Create the Google OAuth client

1. Open <https://console.cloud.google.com/> and pick or create a project.
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**: choose **External** (or **Internal** for a Workspace domain). Set the app name and your support email. Add yourself under **Test users** while the app is in Testing.
4. Add these scopes: `openid`, `email`, `profile`, `.../auth/gmail.readonly`, `.../auth/calendar.readonly`, `.../auth/calendar.events`, `.../auth/calendar.freebusy`.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID**. Type: **Web application**.
6. **Authorized JavaScript origins**:
   - `http://localhost:3000`
   - `https://<your-public-app-host>` (add it when you have one)
7. **Authorized redirect URIs**. The callback is served by the API, not the app:
   - `http://localhost:3001/api/auth/callback/google`
   - `https://<your-public-api-host>/api/auth/callback/google`
8. Create. Copy the client ID and secret.

## Set the environment

Put these in the root `.env`. Never commit it.

```sh
GOOGLE_CLIENT_ID="<client id>"
GOOGLE_CLIENT_SECRET="<client secret>"
ALLOWED_SIGN_IN="you@gmail.com"
```

`ALLOWED_SIGN_IN` takes a comma list of domains (`acme.com`) and full addresses (`you@gmail.com`). A domain also matches its subdomains.

Restart the API and app. Open `http://localhost:3000/sign-in`. Click **Continue with Google**.

## Public URL (ngrok or a real host)

1. Set `API_URL` and `APP_URL` to the public https URLs.
2. Add the matching origin and redirect URI in the Google client (steps 6 and 7).
3. Set `NODE_ENV=production`, `DEV_LOGIN` unset on any shared host, and `AGENT_BRIDGE_SECRET` to 32 or more random characters.
4. Restart. A wrong value stops the boot with a list of what to fix.

## Auth0 (optional)

Create a Regular Web Application in Auth0. Allowed Callback URL: `<API_URL>/api/auth/oauth2/callback/auth0`. Allowed Logout URL: `<APP_URL>`. Set `AUTH0_DOMAIN` (the tenant host, no scheme), `AUTH0_CLIENT_ID` and `AUTH0_CLIENT_SECRET`. Set all three or none. Auth0 reports `email_verified`, and the CRM refuses an unverified email. `ALLOWED_SIGN_IN` still decides who gets an account. This is a built-in button, not an SSO row. Do not also add an SSO provider with ID `auth0`.

## Microsoft (optional)

Create an app registration in Entra ID. Redirect URI (Web): `<API_URL>/api/auth/callback/microsoft`. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and, for one tenant, `MICROSOFT_TENANT_ID`. Microsoft often omits the verified-email claim. The CRM then refuses that sign-in. Use an account whose email Microsoft marks as verified, or use Google.

## Local development

`DEV_LOGIN="true"` adds a "Continue as <email>" button. It works on the machine that runs the CRM, including the production stack from `scripts/run-public.sh`. Leave it unset on every other host.

The bypass is on only when all of these are true:

1. `DEV_LOGIN` is exactly `true`.
2. `ALLOWED_SIGN_IN` holds exactly one full email address. A domain or a list stops the boot.
3. The request itself is local. The TCP peer is `127.0.0.1` or `::1`. The `Host` header is `localhost`, `127.0.0.1` or `[::1]`, on any port. The request has no `x-forwarded-*`, `forwarded`, `x-real-ip`, `ngrok-*` or `cf-*` header.

Anything that arrives through the edge proxy or the ngrok tunnel fails rule 3. The button does not render. The endpoint answers 403. The edge proxy and the ngrok policy also return 404 for any path that contains `dev-login`.

The app decides, once, on the original browser request. A dedicated route handler (`apps/app/app/api/auth/dev-login/route.ts`) checks Host, origin and forwarding headers. Next route handlers cannot see the TCP peer. The edge proxy sits on a different listener and always forwards through a proxy or tunnel, so a request through it fails the header rule or never arrives (404).

The route then calls the API server to server with `x-crm-dev-login-proof`. That header is an HMAC of `AGENT_BRIDGE_SECRET`. The API refuses the call without a valid proof (constant-time compare), without a loopback TCP peer, or when `AGENT_BRIDGE_SECRET` is unset. The generic `/api/*` proxy refuses every path that contains `dev-login`. The route relays the API `Set-Cookie` headers unchanged.

Residual risk: a process on this machine can send forged headers to `localhost:3000`. That process already has local access. Safari does not store `Secure` cookies on `http://localhost`, which Better Auth sets in production. Use Chrome or Firefox for this button.

The session is a normal session for that one address. Google OAuth and `ALLOWED_SIGN_IN` are unchanged. The API and the app log a warning at boot when `DEV_LOGIN` is on.

Use `http://localhost:3000/sign-in`. Chrome and Firefox keep the secure session cookie on `http://localhost`. Safari does not.
