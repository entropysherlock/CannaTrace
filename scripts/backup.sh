#!/usr/bin/env bash
# Saves a full copy of the database to a file you can keep somewhere safe.
#   DATABASE_URL=postgres://... scripts/backup.sh [folder]
# Writes cannatrace-YYYYMMDD-HHMMSS.dump (PostgreSQL custom format) and keeps the newest 14 in that folder.
# The file holds every business record, so store it somewhere private. Check a backup works with
# scripts/restore-check.sh.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the database you want to copy.}"
dir="${1:-backups}"
mkdir -p "$dir"
file="$dir/cannatrace-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file "$file.partial" "$DATABASE_URL"
mv "$file.partial" "$file"
ls -1t "$dir"/cannatrace-*.dump | tail -n +15 | xargs -r rm -f
echo "Saved $file ($(du -h "$file" | cut -f1))"
