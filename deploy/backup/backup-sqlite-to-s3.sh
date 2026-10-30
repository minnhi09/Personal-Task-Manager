#!/usr/bin/env bash
set -euo pipefail

: "${PTM_DATABASE_PATH:?Set PTM_DATABASE_PATH to the live SQLite file}"
: "${PTM_S3_URI:?Set PTM_S3_URI to a private s3:// bucket prefix}"

backup_dir="${PTM_BACKUP_DIR:-/var/backups/personal-task-manager}"
retention_days="${PTM_RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="${backup_dir}/personal-task-manager-${timestamp}.db"

mkdir -p "$backup_dir"
trap 'rm -f "$backup_file"' EXIT

# SQLite's backup command reads a consistent snapshot while the API may be
# using WAL mode. It avoids copying a partially-written database file.
sqlite3 "$PTM_DATABASE_PATH" ".backup '$backup_file'"
aws s3 cp "$backup_file" "${PTM_S3_URI%/}/personal-task-manager-${timestamp}.db" --only-show-errors
find "$backup_dir" -type f -name 'personal-task-manager-*.db' -mtime "+$retention_days" -delete
