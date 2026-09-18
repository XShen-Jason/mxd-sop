#!/bin/sh
set -eu

backup_dir=${1:-/var/backups/ops-desk}
database=${DATABASE_PATH:-/var/lib/ops-desk/ops.sqlite}
catalog=${ITEM_CATALOG_PATH:-$(dirname "$database")/item-catalog.csv}
mkdir -p "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backup_dir/ops-$timestamp.sqlite"
catalog_target="$backup_dir/item-catalog-$timestamp.csv"

sqlite3 "$database" ".backup '$target'"
chmod 600 "$target"
if [ -f "$catalog" ]; then
  cp "$catalog" "$catalog_target"
  chmod 600 "$catalog_target"
fi
find "$backup_dir" -type f -name 'ops-*.sqlite' -mtime +30 -delete
find "$backup_dir" -type f -name 'item-catalog-*.csv' -mtime +30 -delete
echo "Created $target"
if [ -f "$catalog_target" ]; then
  echo "Created $catalog_target"
fi
