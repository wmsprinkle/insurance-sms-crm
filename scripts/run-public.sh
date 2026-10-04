#!/bin/bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${CRM_LOG_DIR:-/tmp/crm-logs}"
PID_DIR="$LOG_DIR/pids"
SECRETS_FILE="$HOME/.crm-free-hosting.env"
BUILT_MARKER="$HOME/.crm-free-hosting.built"
PUBLIC_URL="${PUBLIC_URL:-https://campfire-nervous-shamrock.ngrok-free.dev}"
APP_PORT=3000
API_PORT=3001
AGENT_PORT=2000
EDGE_PORT=8080
HEALTH_TRIES=90

export PATH="/opt/homebrew/opt/node@24/bin:/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

BUILD=auto
BUILD_FLAG=--auto
DETACH=0
for arg in "$@"; do
	case "$arg" in
	--build) BUILD=yes BUILD_FLAG=--build ;;
	--skip-build) BUILD=no BUILD_FLAG=--skip-build ;;
	--auto) BUILD=auto ;;
	--detach) DETACH=1 ;;
	*)
		echo "usage: run-public.sh [--build|--skip-build] [--detach]" >&2
		exit 2
		;;
	esac
done

die() {
	echo "run-public: $*" >&2
	exit 1
}

mkdir -p "$LOG_DIR" "$PID_DIR"

if [ "$DETACH" = "1" ]; then
	nohup "$0" "$BUILD_FLAG" >"$LOG_DIR/run-public.log" 2>&1 &
	echo "started in the background, log $LOG_DIR/run-public.log"
	exit 0
fi

[ -f "$ROOT/.env" ] || die "$ROOT/.env is missing."

set -a
. "$ROOT/.env"
set +a

if [ -n "${DEV_LOGIN:-}" ] && [ "$DEV_LOGIN" != "true" ]; then
	die "DEV_LOGIN must be empty or exactly true."
fi

if [ ! -f "$SECRETS_FILE" ]; then
	umask 077
	{
		echo "AGENT_BRIDGE_SECRET=$(openssl rand -hex 32)"
		echo "CRON_SECRET=$(openssl rand -hex 32)"
	} >"$SECRETS_FILE"
	chmod 600 "$SECRETS_FILE"
fi

set -a
while IFS='=' read -r key value; do
	case "$key" in
	AGENT_BRIDGE_SECRET | CRON_SECRET)
		[ -n "${!key:-}" ] || export "$key=$value"
		;;
	esac
done <"$SECRETS_FILE"
set +a

export NODE_ENV=production
export APP_URL="$PUBLIC_URL"
export API_URL="$PUBLIC_URL"
export NEXT_PUBLIC_API_URL="$PUBLIC_URL"
export API_INTERNAL_URL="http://127.0.0.1:$API_PORT"
export AGENT_URL="http://127.0.0.1:$AGENT_PORT"
if [ "${DEV_LOGIN:-}" = "true" ]; then
	echo "WARNING: DEV_LOGIN=true. The 'Continue as' button works from http://localhost:3000 on this Mac only."
	echo "WARNING: The edge proxy and ngrok refuse /api/auth/dev-login. Never set DEV_LOGIN on another machine."
fi

[ "${#AGENT_BRIDGE_SECRET}" -ge 32 ] || die "AGENT_BRIDGE_SECRET must be 32 characters or more."
[ "${#CRON_SECRET}" -ge 16 ] || die "CRON_SECRET must be 16 characters or more."
[ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ] ||
	die "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set."
command -v ngrok >/dev/null || die "ngrok is not installed."
command -v bun >/dev/null || die "bun is not installed."
command -v node >/dev/null || die "node is not installed."

if [ -f "$PID_DIR/supervisor.pid" ] && kill -0 "$(cat "$PID_DIR/supervisor.pid")" 2>/dev/null; then
	die "already running. Run scripts/stop-public.sh first."
fi

if command -v pg_isready >/dev/null && ! pg_isready -q -h 127.0.0.1 -p 5432; then
	die "Postgres is not accepting connections on 127.0.0.1:5432."
fi

echo $$ >"$PID_DIR/supervisor.pid"

stop_all() {
	trap - EXIT INT TERM
	"$ROOT/scripts/stop-public.sh" --children-only
}
trap 'stop_all; exit 0' INT TERM
trap 'stop_all' EXIT

needs_build() {
	[ "$BUILD" = "yes" ] && return 0
	[ "$BUILD" = "no" ] && return 1
	[ -f "$BUILT_MARKER" ] && return 1
	return 0
}

if needs_build; then
	echo "building"
	for app in api agent app; do
		(cd "$ROOT/apps/$app" && bun run build) >"$LOG_DIR/build-$app.log" 2>&1 ||
			die "build of $app failed. See $LOG_DIR/build-$app.log."
	done
	touch "$BUILT_MARKER"
fi

start() {
	local name="$1"
	shift
	"$@" >"$LOG_DIR/$name.log" 2>&1 &
	echo $! >"$PID_DIR/$name.pid"
}

wait_http() {
	local name="$1" url="$2" tries=0 code
	while [ "$tries" -lt "$HEALTH_TRIES" ]; do
		code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || true)"
		case "$code" in
		2* | 3* | 4*) echo "ok $name ($code)"; return 0 ;;
		esac
		kill -0 "$(cat "$PID_DIR/$name.pid" 2>/dev/null)" 2>/dev/null || die "$name exited. See $LOG_DIR/$name.log."
		tries=$((tries + 1))
		sleep 1
	done
	die "$name did not answer at $url. See $LOG_DIR/$name.log."
}

(cd "$ROOT/apps/api" && PORT=$API_PORT start api bun run start:prod)
(cd "$ROOT/apps/agent" && AGENT_PORT=$AGENT_PORT start agent bun run start)
(cd "$ROOT/apps/app" && start app bun run start -p $APP_PORT -H 127.0.0.1)

wait_http api "http://127.0.0.1:$API_PORT/"
wait_http agent "http://127.0.0.1:$AGENT_PORT/"
wait_http app "http://127.0.0.1:$APP_PORT/sign-in"

start edge node "$ROOT/scripts/edge-proxy.mjs"
wait_http edge "http://127.0.0.1:$EDGE_PORT/sign-in"

internal_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$EDGE_PORT/internal/sync/mailboxes")"
[ "$internal_code" = "404" ] || die "edge proxy exposes /internal (got $internal_code)."

dev_login_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$EDGE_PORT/api/auth/dev-login")"
[ "$dev_login_code" = "404" ] || die "edge proxy exposes dev-login (got $dev_login_code)."

start cron node "$ROOT/scripts/local-cron.mjs"

start ngrok ngrok http "$EDGE_PORT" \
	--url="${PUBLIC_URL#https://}" \
	--traffic-policy-file="$ROOT/scripts/ngrok-policy.yml" \
	--log=stdout --log-format=json

tries=0
until curl -s --max-time 3 http://127.0.0.1:4040/api/tunnels | grep -q "${PUBLIC_URL#https://}"; do
	tries=$((tries + 1))
	[ "$tries" -lt 30 ] || die "ngrok tunnel did not come up. See $LOG_DIR/ngrok.log."
	sleep 1
done

echo "public at $PUBLIC_URL"
echo "logs in $LOG_DIR"

while true; do
	for name in api agent app edge cron ngrok; do
		kill -0 "$(cat "$PID_DIR/$name.pid" 2>/dev/null)" 2>/dev/null || die "$name stopped. See $LOG_DIR/$name.log."
	done
	sleep 5
done
