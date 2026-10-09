#!/bin/bash
set -euo pipefail

DIR="${CRM_BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS=14

mkdir -p "$DIR"
umask 077
OUT="$DIR/crm-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump --no-owner crm | gzip >"$OUT"
find "$DIR" -name 'crm-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "backup $OUT"
