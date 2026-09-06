#!/bin/sh
set -eu

backup_dir=${1:-/var/backups/ops-desk}
database=${DATABASE_PATH:-/var/lib/ops-desk/ops.sqlite}
mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/ops-$timestamp.sqlite"

sqlite3 "$database" ".backup '$target'"
chmod 600 "$target"
find "$backup_dir" -type f -name 'ops-*.sqlite' -mtime +30 -delete
echo "Created $target"
