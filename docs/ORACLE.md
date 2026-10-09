# Run the CRM on Oracle Cloud Always Free

One Ampere A1 (ARM64) Ubuntu 24.04 VM runs everything. It stays on and costs nothing. The kit is in `deploy/oracle/`.

```
internet → Caddy :80/:443 (automatic HTTPS)
            ├─ /internal/*, dev-login   → 404
            ├─ /webhooks/telnyx, /leads/ingest → api   127.0.0.1:3001
            └─ everything else                → app   127.0.0.1:3000
agent 127.0.0.1:2000, cron caller, Postgres 17 (local only)
```

The routes match `scripts/edge-proxy.mjs`. Caddy forwards bytes unchanged, so the Telnyx signature check still passes.

## Before you start

1. The VM has a public IPv4 address. Your SSH key is on it. The default user is `ubuntu`.
2. Oracle console → VCN → Security List: allow ingress TCP **80** and **443** from `0.0.0.0/0`. The script opens the VM firewall. It cannot open the cloud firewall.
3. Your Mac `.env` is complete (Google, Telnyx, Anthropic keys). The kit copies it to the VM. It never prints it.

The repo is private, so the VM never clones it. `deploy.sh` copies the code with rsync from your Mac.

## First deploy

```sh
export CRM_ORACLE_KEY=~/.ssh/<your-key>      # skip if the key is in your ssh agent
deploy/oracle/deploy.sh <vm-ip> --first
```

It copies the code, uploads `.env` to `/etc/crm/crm.env` (mode 600), then runs `setup.sh` on the VM. `setup.sh` installs bun, Node 24, Postgres 17 and Caddy. It creates the `crm` database, builds api, agent and app, runs migrations, installs four systemd units, and starts them. It ends with a health check.

The hostname is `<ip-with-dashes>.sslip.io`. IP `203.0.113.7` gives `203-0-113-7.sslip.io`. Caddy gets a free certificate for it by itself.

## Settings the VM overrides

`run-unit.sh` sets these on every start. The values in your Mac `.env` for them are ignored:

- `NODE_ENV=production`, `APP_URL`, `API_URL`, `NEXT_PUBLIC_API_URL` = `https://<hostname>`.
- `API_INTERNAL_URL` and `AGENT_URL` = the `127.0.0.1` ports.
- `DATABASE_URL` = the VM database (random password in `/etc/crm/db.env`).
- `AGENT_BRIDGE_SECRET` and `CRON_SECRET` = `/etc/crm/secrets.env`, generated on the VM.
- `DEV_LOGIN` is always unset. Dev login is off on the VM.

## Change two URLs after the hostname is known

- Google Cloud → Credentials → your OAuth client:
  - Authorised JavaScript origin: `https://<hostname>`
  - Authorised redirect URI: `https://<hostname>/api/auth/callback/google`
- Telnyx Portal → Messaging → your profile → inbound webhook URL: `https://<hostname>/webhooks/telnyx`

Sign-in fails with `redirect_uri_mismatch` until Google has the new URI.

## Later deploys

```sh
deploy/oracle/deploy.sh <vm-ip>              # sync code, build, migrate, restart, check
deploy/oracle/deploy.sh <vm-ip> --env        # also re-upload .env
deploy/oracle/deploy.sh <vm-ip> --skip-build # restart only
```

Checks: `/sign-in` is 200. `/internal/sync/mailboxes` and `/api/auth/dev-login` are 404. Five units are active.

## Move the existing database

Do this once, with the Mac stack stopped, so no write is lost. This does not touch the running Mac stack until you stop it yourself.

```sh
pg_dump --no-owner --no-acl -Fc crm > crm.dump
scp crm.dump ubuntu@<vm-ip>:
ssh ubuntu@<vm-ip> 'sudo systemctl stop crm-api crm-agent crm-app crm-cron &&
  sudo -u postgres dropdb crm && sudo -u postgres createdb -O crm crm &&
  sudo -u postgres pg_restore --no-owner --role=crm -d crm crm.dump &&
  sudo systemctl start crm-api crm-agent crm-app crm-cron && rm crm.dump'
rm crm.dump
```

Stop the Mac copy (`scripts/stop-public.sh`) so two instances do not run cron jobs.

## Backups

`/etc/cron.d/crm-backup` runs `deploy/oracle/backup.sh` daily at 03:15 UTC. Dumps are in `~/backups/crm-<time>.sql.gz` on the VM disk. Dumps older than 14 days are deleted. The log is `~/backups/backup.log`.

The VM disk is the only copy. Copy dumps to the Mac now and then:

```sh
scp ubuntu@<vm-ip>:backups/crm-*.sql.gz ~/crm-backups/
```

Restore: `gunzip -c crm-<time>.sql.gz | psql -h 127.0.0.1 -U crm crm` (password in `/etc/crm/db.env`).

## Operate

```sh
ssh ubuntu@<vm-ip>
journalctl -u crm-api -f        # also crm-agent, crm-app, crm-cron, caddy
sudo systemctl restart crm-api
```

## Limits

- Oracle can reclaim idle Always Free VMs. Keep the CRM in use and keep off-VM backups.
- A1 capacity is scarce in some regions. Pick another availability domain if creation fails.
- `sslip.io` is a public free DNS service. If it is down, the hostname fails. Move to your own domain later: change `host.env` and the Caddy file, then rerun `setup.sh`.
- `deploy.sh` and `setup.sh` were shell-checked with `bash -n` only. They have not run on a real VM.
