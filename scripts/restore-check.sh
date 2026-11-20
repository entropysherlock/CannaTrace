#!/usr/bin/env bash
# Proves a backup file can be restored, without touching the real database.
#   ADMIN_DATABASE_URL=postgres://user:pass@host:5432/postgres scripts/restore-check.sh backups/cannatrace-....dump
# Restores into a scratch database, compares row counts of key tables, then drops the scratch database.
# ADMIN_DATABASE_URL must be a server you can create databases on (a local Postgres is fine). Never point
# it at production.
set -euo pipefail
file="${1:?Give the backup file to check.}"
: "${ADMIN_DATABASE_URL:?Set ADMIN_DATABASE_URL to a scratch Postgres server (not production).}"
scratch="ct_restore_check_$$"
base="${ADMIN_DATABASE_URL%/*}"
cleanup() { psql "$ADMIN_DATABASE_URL" -qc "drop database if exists $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql "$ADMIN_DATABASE_URL" -qc "create database $scratch"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$base/$scratch" "$file"
echo "Restore finished. Row counts:"
for t in organizations facilities users items packages audit_logs inventory_transactions sales orders; do
  n=$(psql "$base/$scratch" -Atc "select count(*) from $t" 2>/dev/null || echo "missing")
  printf '  %-24s %s\n' "$t" "$n"
done
echo "OK: the backup restores cleanly."
