#!/bin/sh
set -eu
umask 077
mkdir -p /backups
while true; do
  target="/backups/miaoxing-$(date -u +%Y%m%d-%H%M%S).dump"
  if pg_dump -Fc -f "$target.tmp"; then
    mv "$target.tmp" "$target"
    find /backups -name 'miaoxing-*.dump' -mtime +7 -delete
    echo database_backup_completed
  else
    rm -f "$target.tmp"
    echo database_backup_failed >&2
  fi
  sleep 86400
done
