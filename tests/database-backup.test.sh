#!/usr/bin/env bash
# Linux host-tooling regression tests. Docker/SQL are mocked; no real DB is used.
set -Eeuo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fixture=$(mktemp -d)
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/project" "$fixture/backups"
touch "$fixture/project/compose.production.yaml" "$fixture/project/.env.production"
export LC_PROJECT_DIR="$fixture/project" LC_BACKUP_DIR="$fixture/backups"
export MOCK_LOG="$fixture/docker.log"
export PATH="$fixture/bin:$PATH"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$MOCK_LOG"
[[ $1 == compose ]]
shift 7
case $1 in
  exec)
    shift 4
    case $1 in
      psql)
        if [[ "$*" == *pg_database_size* ]]; then printf '1000\n'; fi
        ;;
      pg_dump)
        printf 'fake archive\n'
        [[ ${MOCK_FAIL_DUMP:-0} == 0 ]] || exit 1
        ;;
      pg_restore)
        if [[ "$*" == *--list* ]]; then
          [[ ${MOCK_FAIL_LIST:-0} == 0 ]] || exit 1
          printf 'archive contents\n'
        else
          [[ ${MOCK_FAIL_RESTORE:-0} == 0 ]] || exit 1
        fi
        ;;
    esac
    ;;
  run) [[ ${MOCK_FAIL_MIGRATION:-0} == 0 ]] || exit 1 ;;
  start) [[ ${MOCK_FAIL_START:-0} == 0 ]] || exit 1 ;;
esac
MOCK
cat > "$fixture/bin/flock" <<'MOCK'
#!/usr/bin/env bash
[[ ${MOCK_LOCK_BUSY:-0} == 0 ]]
MOCK
cat > "$fixture/bin/df" <<'MOCK'
#!/usr/bin/env bash
printf 'Filesystem 1024-blocks Used Available Capacity Mounted on\n'
printf 'mock 9000000 1000000 %s 10%% /\n' "${MOCK_FREE_KB:-7000000}"
MOCK
chmod +x "$fixture/bin/"*
tool="$repo/scripts/database-backup.sh"
check() { if ! "$@"; then printf 'FAIL: %s\n' "$*" >&2; exit 1; fi; }
reset_fixture() {
  find "$LC_BACKUP_DIR" -maxdepth 1 -type f -delete
  : > "$MOCK_LOG"
  unset MOCK_FAIL_DUMP MOCK_FAIL_LIST MOCK_FREE_KB MOCK_LOCK_BUSY MOCK_FAIL_RESTORE MOCK_FAIL_MIGRATION MOCK_FAIL_START
}
expect_fail() { if "$@" > "$fixture/output" 2>&1; then cat "$fixture/output"; exit 1; fi; }
old="$LC_BACKUP_DIR/lc-20200101T030000Z.dump"

reset_fixture
printf 'old' > "$old"
touch -t 202001010300 "$old"
printf 'rescue' > "$LC_BACKUP_DIR/before-restore-20200101T030000Z.dump"
printf 'unfinished' > "$LC_BACKUP_DIR/lc-unfinished.partial"
bash "$tool" backup > "$fixture/output"
check test ! -f "$old"
check test -f "$LC_BACKUP_DIR/before-restore-20200101T030000Z.dump"
check test -f "$LC_BACKUP_DIR/lc-unfinished.partial"
check grep -q -- '--interactive=false postgres pg_dump' "$MOCK_LOG"
check grep -q -- 'pg_restore --list' "$MOCK_LOG"
printf 'PASS: backup publishes/validates archive and rotates only old daily backups\n'

for failure in MOCK_FAIL_DUMP MOCK_FAIL_LIST MOCK_FREE_KB MOCK_LOCK_BUSY; do
  reset_fixture
  printf 'old' > "$old"
  touch -t 202001010300 "$old"
  export "$failure=1"
  expect_fail bash "$tool" backup
  check test -f "$old"
  check test "$(find "$LC_BACKUP_DIR" -name 'lc-*.dump' | wc -l | tr -d ' ')" = 1
  check test "$(find "$LC_BACKUP_DIR" -name '.pending-*' | wc -l | tr -d ' ')" = 0
done
printf 'PASS: dump/validation/disk/lock failures never publish or prune\n'

reset_fixture
for invalid in '2026-02-30' '../2026-11-13' '2026-1-2'; do
  expect_fail bash "$tool" restore "$invalid"
done
expect_fail bash "$tool" restore 2026-11-13 < /dev/null
check test ! -s "$MOCK_LOG"
printf 'PASS: invalid dates and noninteractive restore are rejected\n'

# util-linux script gives the actual restore process a PTY for confirmation.
# It is installed on the Ubuntu CI runner. Git Bash can run backup tests only.
if ! command -v script > /dev/null; then
  printf 'SKIP: interactive restore tests require Linux util-linux script\n'
  exit 0
fi
restore_run() {
  printf '%s\n' "$1" | script -q -e -c "bash '$tool' restore 2026-11-13" /dev/null > "$fixture/output" 2>&1
}
seed() {
  reset_fixture
  printf 'archive' > "$LC_BACKUP_DIR/lc-20261113T020000Z.dump"
}

seed
expect_fail restore_run CANCEL
check test ! -s "$MOCK_LOG"
printf 'PASS: cancellation never touches live services or data\n'

seed
export MOCK_FAIL_RESTORE=1
expect_fail restore_run 'RESTORE 2026-11-13'
check test "$(grep -c 'stop app' "$MOCK_LOG" || true)" = 0
check grep -q 'dropdb' "$MOCK_LOG"
printf 'PASS: failed staging validation leaves live services untouched\n'

seed
export MOCK_FAIL_DUMP=1
expect_fail restore_run 'RESTORE 2026-11-13'
check grep -q 'stop app signaling livekit' "$MOCK_LOG"
check test "$(grep -c 'RENAME TO' "$MOCK_LOG" || true)" = 0
check test "$(grep -c 'start --wait' "$MOCK_LOG" || true)" = 0
printf 'PASS: failed rescue backup prevents database switching and restart\n'

seed
export MOCK_FAIL_MIGRATION=1
expect_fail restore_run 'RESTORE 2026-11-13'
check grep -q 'RENAME TO' "$MOCK_LOG"
check test "$(grep -c 'start --wait' "$MOCK_LOG" || true)" = 0
check grep -q 'are stopped' "$fixture/output"
printf 'PASS: migration failure retains recovery data and leaves writers stopped\n'

seed
export MOCK_FAIL_START=1
expect_fail restore_run 'RESTORE 2026-11-13'
check test "$(grep -c 'stop app signaling livekit' "$MOCK_LOG")" = 2
check grep -q 'are stopped' "$fixture/output"
printf 'PASS: failed restart/health check stops any partially restarted services\n'

seed
# UTC late on the previous date is also the requested Berlin calendar date.
printf 'archive' > "$LC_BACKUP_DIR/lc-20261112T233000Z.dump"
restore_run $'2\nRESTORE 2026-11-13'
check grep -q 'Choose backup number' "$fixture/output"
check grep -q 'lc-20261113T020000Z.dump' "$MOCK_LOG"
check grep -q 'start --wait --wait-timeout 120 livekit signaling app' "$MOCK_LOG"
restore_line=$(grep -n 'pg_restore -w' "$MOCK_LOG" | head -n 1 | cut -d: -f1)
stop_line=$(grep -n 'stop app' "$MOCK_LOG" | cut -d: -f1)
dump_line=$(grep -n 'pg_dump' "$MOCK_LOG" | cut -d: -f1)
switch_line=$(grep -n 'RENAME TO' "$MOCK_LOG" | cut -d: -f1)
migrate_line=$(grep -n 'run --rm --no-deps -T --interactive=false migrate' "$MOCK_LOG" | cut -d: -f1)
start_line=$(grep -n 'start --wait' "$MOCK_LOG" | cut -d: -f1)
check test "$restore_line" -lt "$stop_line"
check test "$stop_line" -lt "$dump_line"
check test "$dump_line" -lt "$switch_line"
check test "$switch_line" -lt "$migrate_line"
check test "$migrate_line" -lt "$start_line"
printf 'PASS: date selection and stage/stop/rescue/switch/migrate/start ordering\n'
