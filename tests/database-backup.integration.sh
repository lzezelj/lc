#!/usr/bin/env bash
# Run as a non-root user with PostgreSQL 17 binaries and util-linux installed.
# All data lives in a new temporary cluster, never DATABASE_URL or production.
set -Eeuo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
fixture=$(mktemp -d)
cleanup() {
  pg_ctl -D "$fixture/data" -m immediate stop > /dev/null 2>&1 || true
  rm -rf -- "$fixture"
}
trap cleanup EXIT
export PGHOST="$fixture" PGPORT=5432 PGUSER=lc
initdb -D "$fixture/data" -U lc -A trust > "$fixture/init.log"
pg_ctl -D "$fixture/data" -l "$fixture/server.log" -o "-k $fixture -h ''" start > /dev/null
createdb lc
psql -X -v ON_ERROR_STOP=1 -d lc > /dev/null <<'SQL'
CREATE TABLE servers(id integer PRIMARY KEY, name text NOT NULL);
CREATE TABLE messages(id integer PRIMARY KEY, server_id integer REFERENCES servers, content text);
CREATE TABLE media(id integer PRIMARY KEY, data bytea NOT NULL);
INSERT INTO servers VALUES (1,'before backup');
INSERT INTO messages VALUES (1,1,'original');
INSERT INTO media VALUES (1,decode(repeat('0123456789abcdef',1000),'hex'));
SQL
media_hash=$(psql -X -At -d lc -c 'SELECT md5(data) FROM media')
mkdir -p "$fixture/bin" "$fixture/project" "$fixture/backups"
touch "$fixture/project/compose.production.yaml" "$fixture/project/.env.production"
export LC_PROJECT_DIR="$fixture/project" LC_BACKUP_DIR="$fixture/backups"
export PATH="$fixture/bin:$PATH"
cat > "$fixture/bin/docker" <<'MOCK'
#!/usr/bin/env bash
set -eu
[[ $1 == compose ]]
shift 7
case $1 in
  exec) shift 4; exec "$@" ;;
  cp) cp -- "$2" "${3#postgres:}" ;;
  stop|start) : ;; # No app/media services exist in this isolated cluster.
  run) psql -X -v ON_ERROR_STOP=1 -d lc -c 'SELECT count(*) FROM messages' > /dev/null ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$fixture/bin/docker"
bash "$repo/scripts/database-backup.sh" backup
psql -X -v ON_ERROR_STOP=1 -d lc > /dev/null <<'SQL'
INSERT INTO servers VALUES (2,'after backup');
UPDATE messages SET content='newer live state';
SQL
day=$(TZ=Europe/Berlin date +%F)
printf 'RESTORE %s\n' "$day" | script -q -e -c "bash '$repo/scripts/database-backup.sh' restore '$day'" /dev/null > "$fixture/restore.log" 2>&1 || { cat "$fixture/restore.log"; exit 1; }
[[ $(psql -X -At -d lc -c 'SELECT count(*) FROM servers') == 1 ]]
[[ $(psql -X -At -d lc -c 'SELECT content FROM messages') == original ]]
[[ $(psql -X -At -d lc -c 'SELECT md5(data) FROM media') == "$media_hash" ]]
previous=$(psql -X -At -d postgres -c "SELECT datname FROM pg_database WHERE datname LIKE 'lc_before_%'")
[[ "$previous" =~ ^lc_before_[0-9_]+$ ]]
psql -X -v ON_ERROR_STOP=1 -d postgres -c "ALTER DATABASE $previous ALLOW_CONNECTIONS true" > /dev/null
[[ $(psql -X -At -d "$previous" -c 'SELECT count(*) FROM servers') == 2 ]]
[[ $(psql -X -At -d "$previous" -c 'SELECT content FROM messages') == 'newer live state' ]]
[[ $(find "$LC_BACKUP_DIR" -name 'before-restore-*.dump' | wc -l) == 1 ]]
printf 'PASS: real PostgreSQL archive, staged restore, database switch, media bytes and retained rollback database\n'
