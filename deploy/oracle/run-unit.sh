#!/bin/bash
set -euo pipefail

CONF_DIR="${CRM_CONF_DIR:-/etc/crm}"
REPO="${CRM_REPO:-$HOME/crm}"
export PATH="/usr/local/bin:/usr/bin:/bin"

set -a
. "$CONF_DIR/crm.env"
. "$CONF_DIR/secrets.env"
. "$CONF_DIR/db.env"
. "$CONF_DIR/host.env"
set +a

unset DEV_LOGIN DIRECT_DATABASE_URL POSTGRES_URL_NON_POOLING TEST_DATABASE_URL

export NODE_ENV=production
export APP_URL="https://$CRM_HOST"
export API_URL="https://$CRM_HOST"
export NEXT_PUBLIC_API_URL="https://$CRM_HOST"
export API_INTERNAL_URL="http://127.0.0.1:3001"
export AGENT_URL="http://127.0.0.1:2000"

[ "${#AGENT_BRIDGE_SECRET}" -ge 32 ] || { echo "AGENT_BRIDGE_SECRET must be 32 characters or more." >&2; exit 1; }
[ "${#CRON_SECRET}" -ge 16 ] || { echo "CRON_SECRET must be 16 characters or more." >&2; exit 1; }

cd "$REPO/$1"
shift
exec "$@"
