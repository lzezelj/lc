#!/usr/bin/env bash
# Host-side tooling: never source the production environment file into the shell.
set -Eeuo pipefail
umask 077

PROJECT_DIR=${LC_PROJECT_DIR:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)}
BACKUP_DIR=${LC_BACKUP_DIR:-/home/lc/lc-backups}
DATE_ZONE=Europe/Berlin
RETAIN_MINUTES=20160 # 14 * 24 * 60; only daily archives are rotated.
RESERVE_BYTES=1073741824
partial_dir=
container_archive=
staging_db=
stopped=false
rollback_db=

die() { printf '%s\n' "$*" >&2; exit 1; }
compose() { docker compose --project-directory "$PROJECT_DIR" --env-file "$PROJECT_DIR/.env.production" -f "$PROJECT_DIR/compose.production.yaml" "$@"; }
pg() { compose exec -T --interactive=false postgres "$@"; }
sql() { pg psql -X -w -U lc -d postgres -v ON_ERROR_STOP=1 -At -c "$1"; }

finish() {
  local status=$?
  trap - EXIT
  if [[ -n "$container_archive" ]]; then pg rm -f -- "$container_archive" >/dev/null 2>&1 || true; fi
  if [[ -n "$staging_db" ]]; then pg dropdb -w -U lc --if-exists "$staging_db" >/dev/null 2>&1 || true; fi
  if [[ -n "$partial_dir" ]]; then
    rm -f -- "$partial_dir/archive.partial" "$partial_dir/archive.list"
    rmdir -- "$partial_dir" 2>/dev/null || true
  fi
  if (( status != 0 )) && $stopped; then
    # start --wait can start processes before returning a health-check failure.
    if compose stop app signaling livekit; then
      printf 'FAILED: app, signaling and LiveKit are stopped. Do not restart until recovery is checked.\n' >&2
    else
      printf 'FAILED: could not stop all services. Check service state immediately; recovery is incomplete.\n' >&2
    fi
    printf 'Previous database (if switched): %s\n' "${rollback_db:-not switched}" >&2
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_space() {
  local database_bytes available
  database_bytes=$(sql "SELECT pg_database_size('lc')")
  [[ "$database_bytes" =~ ^[0-9]+$ ]] || die 'Cannot determine database size.'
  available=$(df -Pk -- "$BACKUP_DIR" | awk 'END {printf "%.0f", $4 * 1024}')
  # Conservative preflight estimate, not a hard quota or a growth guarantee.
  (( available >= RESERVE_BYTES + database_bytes * $1 + ${2:-0} )) || die 'Insufficient free space: preserve 1 GiB plus room for database/backup copies. No old backups were deleted.'
}

copy_archive() {
  container_archive="/tmp/lc-backup-${operation_id}.dump"
  compose cp "$1" "postgres:$container_archive"
}
clear_archive() {
  pg rm -f -- "$container_archive"
  container_archive=
}

make_backup() {
  local prefix=$1 archive
  require_space 2
  archive="$BACKUP_DIR/${prefix}-$(date -u +%Y%m%dT%H%M%S%NZ).dump"
  [[ ! -e "$archive" ]] || die 'Backup filename collision.'
  partial_dir=$(mktemp -d "$BACKUP_DIR/.pending-XXXXXXXX")
  # No stdin attachment: avoids the silent Compose exec hang seen on this host.
  pg pg_dump -w -U lc -d lc -Fc --lock-wait-timeout=30s > "$partial_dir/archive.partial"
  [[ -s "$partial_dir/archive.partial" ]] || die 'Empty backup; rotation skipped.'
  copy_archive "$partial_dir/archive.partial"
  pg pg_restore --list "$container_archive" > "$partial_dir/archive.list"
  clear_archive
  mv -- "$partial_dir/archive.partial" "$archive"
  rm -f -- "$partial_dir/archive.list"
  rmdir -- "$partial_dir"
  partial_dir=
  printf 'Backup saved: %s (%s bytes)\n' "$archive" "$(stat -c %s "$archive")"
}

[[ $# -ge 1 ]] || die 'Usage: database-backup.sh backup | restore YYYY-MM-DD'
command=$1
shift
[[ "$command" == backup || "$command" == restore ]] || die 'Unknown command.'
if [[ "$command" == backup ]]; then
  [[ $# -eq 0 ]] || die 'backup takes no arguments.'
else
  [[ $# -eq 1 && "$1" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die 'Use restore YYYY-MM-DD.'
  requested=$1
  [[ $(TZ=$DATE_ZONE date -d "$requested" +%F 2>/dev/null) == "$requested" ]] || die 'Invalid calendar date.'
  [[ -t 0 ]] || die 'Live restore requires an interactive terminal.'
fi

[[ -f "$PROJECT_DIR/compose.production.yaml" && -f "$PROJECT_DIR/.env.production" ]] || die 'Production Compose/configuration not found.'
[[ "$BACKUP_DIR" == /* && ! -L "$BACKUP_DIR" ]] || die 'Backup directory must be an absolute, non-symlink path.'
mkdir -p -- "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"
exec 9> "$BACKUP_DIR/.operations.lock"
flock -n 9 || die 'Another backup/restore is already running.'
operation_id="$(date -u +%Y%m%d%H%M%S)_$$"

if [[ "$command" == backup ]]; then
  make_backup lc
  # Only publish/rotate after a successful export and archive-directory check.
  # Rescue archives and partials are never part of automatic retention.
  while IFS= read -r -d '' old; do
    name=${old##*/}
    if [[ "$name" =~ ^lc-[0-9]{8}T[0-9]{6}([0-9]{9})?Z\.dump$ && ! -L "$old" ]]; then
      rm -- "$old"
      printf 'Expired backup removed: %s\n' "$name"
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'lc-*.dump' -mmin +"$RETAIN_MINUTES" -print0)
  exit 0
fi

archives=()
shopt -s nullglob
for archive in "$BACKUP_DIR"/lc-*.dump; do
  [[ -f "$archive" && ! -L "$archive" ]] || continue
  name=${archive##*/}
  if [[ "$name" =~ ^lc-([0-9]{8})T([0-9]{6})([0-9]{9})?Z\.dump$ ]]; then
    day=${BASH_REMATCH[1]}; clock=${BASH_REMATCH[2]}
    stamp="${day:0:4}-${day:4:2}-${day:6:2} ${clock:0:2}:${clock:2:2}:${clock:4:2} UTC"
    local_day=$(TZ=$DATE_ZONE date -d "$stamp" +%F 2>/dev/null) || continue
    [[ "$local_day" == "$requested" ]] && archives+=("$archive")
  fi
done
(( ${#archives[@]} > 0 )) || die "No successful backup for $requested ($DATE_ZONE)."
printf 'Backups for %s (%s); filenames contain UTC times:\n' "$requested" "$DATE_ZONE"
for index in "${!archives[@]}"; do
  printf '%d) %s (%s bytes)\n' "$((index + 1))" "${archives[index]##*/}" "$(stat -c %s "${archives[index]}")"
done
index=1
if (( ${#archives[@]} > 1 )); then
  read -r -p 'Choose backup number: ' index
  [[ "$index" =~ ^[1-9][0-9]{0,3}$ ]] || die 'Invalid choice.'
  (( index <= ${#archives[@]} )) || die 'Invalid choice.'
fi
selected=${archives[index-1]}
printf '\nSelected: %s\nThis replaces live data with that snapshot. Later messages/accounts may disappear.\nCalls will be interrupted. The current database and a rescue archive will be retained.\n' "$selected"
read -r -p "Type RESTORE $requested to proceed: " confirmation
[[ "$confirmation" == "RESTORE $requested" ]] || die 'Restore cancelled; live data unchanged.'
require_space 4 "$(( $(stat -c %s "$selected") * 4 ))"
copy_archive "$selected"
staging_db="lc_restore_$operation_id"
pg createdb -w -U lc -T template0 "$staging_db"
pg pg_restore -w -U lc -d "$staging_db" --single-transaction "$container_archive"
clear_archive
printf 'Staging restore succeeded. Stopping application and media services.\n'
# Set before stop so a partially failed stop is also treated as maintenance.
stopped=true
compose stop app signaling livekit
make_backup before-restore
rollback_db="lc_before_$operation_id"
# Generated identifiers contain only fixed prefixes, digits and underscores.
# Admission is blocked and remaining connections are terminated before renaming.
sql "ALTER DATABASE lc ALLOW_CONNECTIONS false;" >/dev/null
sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='lc';" >/dev/null
pg psql -X -w -U lc -d postgres -v ON_ERROR_STOP=1 --single-transaction -c \
  "ALTER DATABASE lc RENAME TO $rollback_db; ALTER DATABASE $staging_db RENAME TO lc;"
staging_db=
# This runs the deployed image's migrations; Compose start alone would not.
compose run --rm --no-deps -T --interactive=false migrate
compose start --wait --wait-timeout 120 livekit signaling app
stopped=false
printf 'Restore completed. Check website health, sign-in and representative data.\nPrevious database retained (connections disabled): %s\nRescue archives are not rotated automatically. See docs/architecture/infrastructure.md for cleanup/rollback.\n' "$rollback_db"
