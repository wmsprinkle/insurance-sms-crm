#!/bin/bash
set -euo pipefail

BUN_VERSION="1.3.12"
NODE_MAJOR=24
PG_MAJOR=17
CONF_DIR=/etc/crm
SERVICES="crm-api crm-agent crm-app crm-cron"

HOST="${1:-${CRM_HOST:-}}"
[ -n "$HOST" ] || { echo "usage: setup.sh <ip-with-dashes>.sslip.io" >&2; exit 2; }
case "$HOST" in
*.*) ;;
*) echo "setup: host must be a full hostname." >&2; exit 2 ;;
esac

[ "$(id -u)" != "0" ] || { echo "setup: run as a normal user with sudo, not root." >&2; exit 2; }
sudo -n true 2>/dev/null || { echo "setup: sudo without a password is required." >&2; exit 2; }

REPO="${CRM_REPO:-$HOME/crm}"
USER_NAME="$(id -un)"
HERE="$REPO/deploy/oracle"

[ -f "$REPO/package.json" ] || { echo "setup: $REPO has no repo. Run deploy.sh from the Mac first." >&2; exit 1; }
[ -f "$CONF_DIR/crm.env" ] || [ -f "$HOME/crm.env.upload" ] || { echo "setup: upload the env file first (deploy.sh does it)." >&2; exit 1; }

export DEBIAN_FRONTEND=noninteractive

step() { echo "==> $*"; }

step "base packages"
sudo apt-get update -y
sudo apt-get install -y curl ca-certificates gnupg unzip rsync openssl debian-keyring debian-archive-keyring apt-transport-https iptables-persistent git build-essential

mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if [ "$mem_kb" -lt 6000000 ] && [ ! -f /swapfile ]; then
	step "2G swap (RAM under 6 GB)"
	sudo fallocate -l 2G /swapfile
	sudo chmod 600 /swapfile
	sudo mkswap /swapfile
	sudo swapon /swapfile
	echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

step "node $NODE_MAJOR"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "$NODE_MAJOR" ]; then
	curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
	sudo apt-get install -y nodejs
fi

step "bun $BUN_VERSION"
if [ "$(/usr/local/bin/bun --version 2>/dev/null || true)" != "$BUN_VERSION" ]; then
	tmp="$(mktemp -d)"
	curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-aarch64.zip" -o "$tmp/bun.zip"
	unzip -q "$tmp/bun.zip" -d "$tmp"
	sudo install -m 755 "$tmp"/bun-linux-aarch64/bun /usr/local/bin/bun
	rm -rf "$tmp"
fi

step "postgres $PG_MAJOR"
if ! command -v psql >/dev/null || ! dpkg -s "postgresql-$PG_MAJOR" >/dev/null 2>&1; then
	sudo install -d /usr/share/postgresql-common/pgdg
	sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
	echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" |
		sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
	sudo apt-get update -y
	sudo apt-get install -y "postgresql-$PG_MAJOR" "postgresql-client-$PG_MAJOR"
fi
sudo systemctl enable --now postgresql

step "caddy"
if ! command -v caddy >/dev/null; then
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
	sudo apt-get update -y
	sudo apt-get install -y caddy
fi

step "firewall (80, 443)"
for port in 80 443; do
	sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
		sudo iptables -I INPUT 6 -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save >/dev/null

step "config in $CONF_DIR"
sudo install -d -m 750 -o root -g "$USER_NAME" "$CONF_DIR"
if [ -f "$HOME/crm.env.upload" ]; then
	sudo install -m 600 -o "$USER_NAME" -g "$USER_NAME" "$HOME/crm.env.upload" "$CONF_DIR/crm.env"
	rm -f "$HOME/crm.env.upload"
fi
if [ ! -f "$CONF_DIR/secrets.env" ]; then
	(
		umask 077
		{
			echo "AGENT_BRIDGE_SECRET=$(openssl rand -hex 32)"
			echo "CRON_SECRET=$(openssl rand -hex 32)"
		} | sudo tee "$CONF_DIR/secrets.env" >/dev/null
	)
	sudo chown "$USER_NAME:$USER_NAME" "$CONF_DIR/secrets.env"
fi
if [ ! -f "$CONF_DIR/db.env" ]; then
	db_password="$(openssl rand -hex 24)"
	(
		umask 077
		echo "DATABASE_URL=postgresql://crm:${db_password}@127.0.0.1:5432/crm?schema=public" | sudo tee "$CONF_DIR/db.env" >/dev/null
	)
	sudo chown "$USER_NAME:$USER_NAME" "$CONF_DIR/db.env"
	sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm') THEN CREATE ROLE crm LOGIN; END IF; END \$\$;"
	sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER ROLE crm PASSWORD '${db_password}';"
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'crm'" | grep -q 1 ||
	sudo -u postgres createdb -O crm crm
echo "CRM_HOST=$HOST" | sudo tee "$CONF_DIR/host.env" >/dev/null
sudo chmod 640 "$CONF_DIR/host.env"
sudo chown "$USER_NAME:$USER_NAME" "$CONF_DIR/host.env"

step "pgpass for backups"
(
	umask 077
	db_url="$(grep '^DATABASE_URL=' "$CONF_DIR/db.env" | cut -d= -f2-)"
	pw="${db_url#postgresql://crm:}"
	pw="${pw%%@*}"
	echo "127.0.0.1:5432:crm:crm:$pw" >"$HOME/.pgpass"
)
chmod 600 "$HOME/.pgpass"

if [ "${SKIP_BUILD:-0}" != "1" ]; then
	step "install and build"
	run="$HERE/run-unit.sh"
	chmod +x "$HERE"/*.sh
	"$run" . /usr/local/bin/bun install --frozen-lockfile
	for app in api agent app; do
		"$run" "apps/$app" /usr/local/bin/bun run build
	done
	step "database migrations"
	"$run" . /usr/local/bin/bun run db:deploy
fi

step "systemd units"
chmod +x "$HERE"/*.sh
for unit in $SERVICES; do
	sed -e "s#__REPO__#$REPO#g" -e "s#__USER__#$USER_NAME#g" "$HERE/systemd/$unit.service" |
		sudo tee "/etc/systemd/system/$unit.service" >/dev/null
done
sudo systemctl daemon-reload

step "caddy config for $HOST"
sed -e "s#__HOST__#$HOST#g" "$HERE/Caddyfile" | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable caddy
sudo systemctl reload-or-restart caddy

step "backup cron (daily 03:15 UTC)"
echo "15 3 * * * $USER_NAME $HERE/backup.sh >>$HOME/backups/backup.log 2>&1" | sudo tee /etc/cron.d/crm-backup >/dev/null
sudo chmod 644 /etc/cron.d/crm-backup
mkdir -p "$HOME/backups"

step "start services"
for unit in $SERVICES; do
	sudo systemctl enable "$unit" >/dev/null
	sudo systemctl restart "$unit"
done

echo "setup done. Public at https://$HOST"
