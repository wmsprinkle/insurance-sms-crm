# Free hosting from this Mac

The CRM runs on your Mac and is public at <https://campfire-nervous-shamrock.ngrok-free.dev> through your free ngrok domain. It costs nothing. It works only while the Mac is on, awake and online.

## How it is wired

```
internet → ngrok → edge proxy 127.0.0.1:8080
                    ├─ /webhooks/telnyx, /leads/ingest → api   :3001
                    └─ everything else                 → app   :3000 (proxies /api/*, /eve/* to api and agent)
```

- `/internal/*` is blocked twice: by the ngrok traffic policy (`scripts/ngrok-policy.yml`) and by the edge proxy (`scripts/edge-proxy.mjs`). The proxy forwards bytes and headers unchanged, so the Telnyx signature check still passes.
- `scripts/local-cron.mjs` replaces Vercel cron. It posts to the five `/internal/*` jobs with the same schedules as `vercel.json` (UTC).
- The agent schedules itself inside `eve start`.
- Production mode: `NODE_ENV=production`. The script refuses to start if `DEV_LOGIN` is set. Sign-in is Google only.

## One manual step

In Google Cloud → APIs & Services → Credentials → your OAuth client:

- Authorised JavaScript origin: `https://campfire-nervous-shamrock.ngrok-free.dev`
- Authorised redirect URI: `https://campfire-nervous-shamrock.ngrok-free.dev/api/auth/callback/google`

Without this, Google sign-in fails with `redirect_uri_mismatch`.

## Start and stop

```sh
scripts/run-public.sh            # builds on first run, then starts everything, stays in the foreground
scripts/run-public.sh --build    # rebuild after a code change
scripts/run-public.sh --detach   # run in the background
scripts/stop-public.sh
```

The script reads `.env` at runtime. It never prints or copies it. It creates `~/.crm-free-hosting.env` (mode 600) once, holding `AGENT_BRIDGE_SECRET` and `CRON_SECRET` if `.env` has none. Logs are in `/tmp/crm-logs` (`api.log`, `app.log`, `agent.log`, `edge.log`, `cron.log`, `ngrok.log`).

Database migrations are not run by this script. Run `bun run db:deploy` yourself after pulling a change that adds one.

## Start at login, restart on crash

```sh
sed -e "s#__REPO__#$(pwd)#g" -e "s#__HOME__#$HOME#g" scripts/com.crm.free-hosting.plist \
  > ~/Library/LaunchAgents/com.crm.free-hosting.plist
launchctl load ~/Library/LaunchAgents/com.crm.free-hosting.plist
```

Remove it with `launchctl unload ~/Library/LaunchAgents/com.crm.free-hosting.plist`. The plist runs the script under `caffeinate -i`, which stops idle sleep. Closing the lid still sleeps the Mac unless it is on power with an external display. Also set System Settings → Battery/Energy → "Prevent automatic sleeping on power adapter when the display is off".

## Check status

```sh
curl -sI https://campfire-nervous-shamrock.ngrok-free.dev/sign-in | head -1     # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://campfire-nervous-shamrock.ngrok-free.dev/internal/sync/mailboxes   # 404
curl -s http://127.0.0.1:4040/api/tunnels | head -c 300                          # ngrok dashboard data
tail -f /tmp/crm-logs/cron.log
```

## ngrok free warning page

Free ngrok shows a "You are about to visit…" page to browsers on first visit. Click Visit Site. It does not affect Telnyx webhooks or API calls that send an `ngrok-skip-browser-warning` header. It cannot be removed on the free plan. Free ngrok also allows one domain and limits bandwidth and requests per month.

## Honest limits

- The Mac sleeps, loses Wi-Fi or reboots: the site goes down and cron jobs in that window are skipped.
- Your home internet is the server. The Postgres database lives on this Mac. Back it up (`pg_dump crm`).
- Telnyx retries failed webhooks for a short time only.

## Always-on free alternative: Oracle Cloud Always Free

An Oracle Cloud Always Free ARM VM (up to 4 OCPU, 24 GB RAM) stays on and costs nothing. It needs an Oracle account with card verification. Oracle does not charge the card for Always Free resources. Steps:

1. Create the account. Pick a home region that has Ampere A1 capacity.
2. Create an Ubuntu 24.04 `VM.Standard.A1.Flex` instance (4 OCPU, 24 GB). Add your SSH key.
3. Install Postgres 17, Node 24 and bun. Clone the repo. Create `.env` there.
4. Restore the database: `pg_dump crm` on the Mac, `psql` on the VM.
5. Free public https without opening ports: a Cloudflare Tunnel (needs a free Cloudflare account and a domain on Cloudflare) pointing at `http://127.0.0.1:8080`, or the same ngrok domain with `ngrok http 8080`. Adjust `PUBLIC_URL` and the Google redirect URI if the domain changes. Update the Telnyx webhook URL.
6. Replace `launchd` with a `systemd` unit that runs `scripts/run-public.sh`. Replace `caffeinate` with nothing. The ngrok binary path and `/opt/homebrew` entries in `run-public.sh` need a Linux edit.
7. Stop the Mac copy so two instances do not run cron jobs.

Oracle can reclaim idle Always Free VMs. Keep it in use and take backups.

## Rejected free options

- Vercel Hobby: forbids commercial use. Crons run once a day at most. The mailbox sync needs every 5 minutes and the agent needs every minute.
- Render free: web services sleep after 15 minutes idle. The free Postgres expires after 30 days.
- Fly.io: no free tier for new accounts now. Cards are required.
- Koyeb free: one small instance that sleeps when idle, no persistent Postgres on the free plan, no cron.
