#!/bin/bash
set -uo pipefail

LOG_DIR="${CRM_LOG_DIR:-/tmp/crm-logs}"
PID_DIR="$LOG_DIR/pids"
STOP_WAIT=10

if [ "${1:-}" != "--children-only" ] && [ -f "$PID_DIR/supervisor.pid" ]; then
	supervisor="$(cat "$PID_DIR/supervisor.pid")"
	kill -TERM "$supervisor" 2>/dev/null || true
	sleep 1
fi

stop_tree() {
	local pid="$1" child
	for child in $(pgrep -P "$pid" 2>/dev/null); do
		stop_tree "$child"
	done
	kill -TERM "$pid" 2>/dev/null || true
}

for name in ngrok cron edge app agent api; do
	file="$PID_DIR/$name.pid"
	[ -f "$file" ] || continue
	pid="$(cat "$file")"
	stop_tree "$pid"
	waited=0
	while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$STOP_WAIT" ]; do
		sleep 1
		waited=$((waited + 1))
	done
	kill -KILL "$pid" 2>/dev/null || true
	rm -f "$file"
done

rm -f "$PID_DIR/supervisor.pid"
echo "stopped"
