# OAuth sign-in setup

Sign-in is Google (and Microsoft, if you configure it) through Better Auth. No password, email code or magic link exists. Nobody can sign in until you finish the steps below.

## What the code enforces

1. A provider must confirm the email address. An unverified email is refused.
2. `ALLOWED_SIGN_IN` is checked on every sign-in, after the provider answers. Remove an address and that person cannot start a new session.
3. Accounts never link by email alone. No provider is trusted for linking.
4. The sign-in page shows only the buttons you configured. With none, it shows "No way in yet".
5. In production the API refuses to boot with no OAuth credentials, a non-https `API_URL` or `APP_URL`, or a weak `AGENT_BRIDGE_SECRET`.
6. `DEV_LOGIN` works only when `NODE_ENV` is not `production` and both URLs are localhost. Any other setup stops the API and app at boot.

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
3. Set `NODE_ENV=production`, `DEV_LOGIN` unset, and `AGENT_BRIDGE_SECRET` to 32 or more random characters.
4. Restart. A wrong value stops the boot with a list of what to fix.

## Microsoft (optional)

Create an app registration in Entra ID. Redirect URI (Web): `<API_URL>/api/auth/callback/microsoft`. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and, for one tenant, `MICROSOFT_TENANT_ID`. Microsoft often omits the verified-email claim. The CRM then refuses that sign-in. Use an account whose email Microsoft marks as verified, or use Google.

## Local development

`DEV_LOGIN="true"` adds a "Continue as <email>" button on localhost only. `ALLOWED_SIGN_IN` must hold a full address. Leave it unset in every shared or public environment.
