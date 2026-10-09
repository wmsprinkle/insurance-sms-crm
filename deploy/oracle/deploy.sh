#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VM_USER="${CRM_ORACLE_USER:-ubuntu}"
SSH_KEY="${CRM_ORACLE_KEY:-}"
ENV_FILE="${CRM_ENV_FILE:-$ROOT/.env}"
REMOTE_DIR="crm"

usage() {
	echo "usage: deploy.sh <vm-ip> [--first] [--env] [--skip-build]" >&2
	echo "  --first       run setup.sh (installs everything). Needed once." >&2
	echo "  --env         upload the env file again (also done with --first)." >&2
	echo "  --skip-build  restart only, no install or build." >&2
	exit 2
}

[ $# -ge 1 ] || usage
IP="$1"
shift
case "$IP" in
*[!0-9.]* | "") echo "deploy: <vm-ip> must be an IPv4 address." >&2; exit 2 ;;
esac

FIRST=0 ENV=0 SKIP_BUILD=0
for arg in "$@"; do
	case "$arg" in
	--first) FIRST=1 ENV=1 ;;
	--env) ENV=1 ;;
	--skip-build) SKIP_BUILD=1 ;;
	*) usage ;;
	esac
done

HOST="${IP//./-}.sslip.io"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
[ -z "$SSH_KEY" ] || SSH_OPTS+=(-i "$SSH_KEY")
TARGET="$VM_USER@$IP"

rsh() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }

echo "==> sync code to $TARGET:~/$REMOTE_DIR"
rsync -az --delete \
	-e "ssh ${SSH_OPTS[*]}" \
	--exclude '.git/' --exclude 'node_modules/' --exclude '.next/' --exclude '.turbo/' \
	--exclude '.eve/' --exclude 'dist/' --exclude '.env' --exclude '.env.*' \
	--include '.env.example' --exclude 'coverage/' --exclude '*.log' \
	"$ROOT/" "$TARGET:$REMOTE_DIR/"

if [ "$ENV" = "1" ]; then
	[ -f "$ENV_FILE" ] || { echo "deploy: env file $ENV_FILE is missing." >&2; exit 1; }
	echo "==> upload env file (mode 600, not printed)"
	(umask 077 && scp "${SSH_OPTS[@]}" -q "$ENV_FILE" "$TARGET:crm.env.upload")
	rsh "chmod 600 crm.env.upload"
fi

if [ "$FIRST" = "1" ]; then
	rsh "chmod +x $REMOTE_DIR/deploy/oracle/*.sh && SKIP_BUILD=$SKIP_BUILD $REMOTE_DIR/deploy/oracle/setup.sh $HOST"
else
	if [ "$ENV" = "1" ]; then
		rsh "sudo install -m 600 -o $VM_USER -g $VM_USER crm.env.upload /etc/crm/crm.env && rm -f crm.env.upload"
	fi
	if [ "$SKIP_BUILD" != "1" ]; then
		rsh "cd $REMOTE_DIR && chmod +x deploy/oracle/*.sh && R=deploy/oracle/run-unit.sh && \$R . /usr/local/bin/bun install --frozen-lockfile && for a in api agent app; do \$R apps/\$a /usr/local/bin/bun run build; done && \$R . /usr/local/bin/bun run db:deploy"
	fi
	rsh "sudo systemctl restart crm-api crm-agent crm-app crm-cron"
fi

echo "==> health check https://$HOST"
check() {
	local label="$1" expect="$2" method="$3" path="$4" code tries=0
	while [ "$tries" -lt 30 ]; do
		code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X "$method" "https://$HOST$path" || true)"
		if [ "$code" = "$expect" ]; then
			echo "ok   $label ($code)"
			return 0
		fi
		tries=$((tries + 1))
		sleep 4
	done
	echo "FAIL $label: got $code, expected $expect" >&2
	return 1
}
rc=0
check "sign-in page" 200 GET /sign-in || rc=1
check "/internal blocked" 404 POST /internal/sync/mailboxes || rc=1
check "dev-login blocked" 404 POST /api/auth/dev-login || rc=1
rsh "systemctl is-active crm-api crm-agent crm-app crm-cron caddy postgresql" || rc=1
exit "$rc"
