#!/usr/bin/env bash
set -euo pipefail
umask 077

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="/home/azureuser/quotehub-backups"
install -d -m 700 -o azureuser -g azureuser "$backup_dir"
exec 9>/run/lock/quotehub-backup.lock
flock -n 9 || exit 0

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$backup_dir/quotehub-$stamp.dump.partial"
destination="$backup_dir/quotehub-$stamp.dump"
trap 'rm -f -- "$temporary"' EXIT
cd "$app_dir"
docker compose exec -T postgres pg_dump -U quotehub -d quotehub -Fc > "$temporary"
test -s "$temporary"
docker compose exec -T postgres pg_restore --list < "$temporary" > /dev/null
chown azureuser:azureuser "$temporary"
mv -- "$temporary" "$destination"
find "$backup_dir" -maxdepth 1 -type f -name 'quotehub-*.dump' -mtime +7 -delete
printf 'PostgreSQL backup created: %s\n' "$destination"
