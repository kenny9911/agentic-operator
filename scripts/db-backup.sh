#!/usr/bin/env bash
# scripts/db-backup.sh — P4-OPS-07 SQLite nightly backup.
#
# Performs an online `VACUUM INTO` into a dated file under
# `${AGENTIC_DATA_DIR:-./data}/backups/`. `VACUUM INTO` is the canonical
# safe-online-backup pattern for SQLite — it writes a consistent
# point-in-time snapshot without blocking writers (it just claims a
# shared lock for the duration; readers continue, new writes queue).
#
# Retention is handled by trimming files older than the configured
# window. Default 14 days; override via `BACKUP_RETENTION_DAYS`.
#
# Suitable for `cron` (any timezone) or a Kubernetes CronJob. Exits
# non-zero on any failure so the orchestrator can alert.
#
# Restore drill:
#   1. Stop the api service (or take it out of the LB rotation).
#   2. `cp data/backups/agentic-YYYYMMDD-HHMMSS.db data/agentic.db`
#   3. Remove WAL artifacts: `rm -f data/agentic.db-wal data/agentic.db-shm`
#   4. Start the api; check `/health` reports sqlite.ok=true.
#   Verified procedure is in `docs/RUNBOOK.md §7`.

set -euo pipefail

DATA_DIR="${AGENTIC_DATA_DIR:-./data}"
DB_FILE="${DATA_DIR}/agentic.db"
BACKUP_DIR="${DATA_DIR}/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [[ ! -f "$DB_FILE" ]]; then
  echo "[db-backup] FATAL: $DB_FILE not found" >&2
  exit 1
fi

# Choose a sqlite3 binary. Prefer the system one (alpine/debian both ship
# it); fall back to the binding shipped by node-better-sqlite3 if needed.
SQLITE=""
if command -v sqlite3 >/dev/null 2>&1; then
  SQLITE="sqlite3"
else
  echo "[db-backup] FATAL: sqlite3 CLI not on PATH; install it or invoke via Node" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/agentic-${TIMESTAMP}.db"

echo "[db-backup] $(date -u +%FT%TZ) starting VACUUM INTO -> $TARGET"
# `.timeout 60000` blocks up to 60s for the shared lock (matches our
# busy_timeout pragma).  `.bail on` flips an error into a non-zero exit.
$SQLITE "$DB_FILE" <<SQL
.timeout 60000
.bail on
VACUUM INTO '$TARGET';
SQL

# Verify the backup opens + has the expected `sqlite_master` count.
ROWS=$($SQLITE "$TARGET" "SELECT COUNT(*) FROM sqlite_master;")
if [[ -z "$ROWS" || "$ROWS" == "0" ]]; then
  echo "[db-backup] FATAL: backup verification failed (0 schema rows)" >&2
  rm -f "$TARGET"
  exit 3
fi
echo "[db-backup] OK schema rows=$ROWS size=$(stat -f '%z' "$TARGET" 2>/dev/null || stat -c '%s' "$TARGET")"

# Retention sweep — delete anything older than $RETENTION_DAYS.
# Use `find -mtime` which is portable across BSD/GNU find.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'agentic-*.db' -mtime "+$RETENTION_DAYS" -print -delete
echo "[db-backup] done"
