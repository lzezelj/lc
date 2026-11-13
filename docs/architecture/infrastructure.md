# Infrastructure, deployment and operations

Cloudflare/Caddy, network boundaries, deployment/CI, configuration/secrets, rate limits, failure behavior, observability, limitations and scaling.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Database and persistence](database.md), [Authentication and authorization](authentication.md), [Voice sessions and transports](voice-and-media.md).

## Cloudflare

Cloudflare is the authoritative DNS provider. It proxies the application and
signaling hostnames, terminates the public edge connection, filters common
automated traffic, and forwards allowed requests to Caddy over TLS. Cloudflare
does not proxy the LiveKit media ports.

## Caddy

Caddy is the only public HTTP reverse proxy on the Hetzner server. It obtains
and renews origin certificates and routes requests by hostname:

| Hostname | Destination |
| --- | --- |
| `lc.lzezelj.com` | Next.js on `app:3000` |
| `signal.lzezelj.com` | signaling service on `signaling:3001` |
| `livekit.lzezelj.com` | LiveKit HTTP/WebSocket endpoint on host port `7880` |

## Planned application hostname change

The current application hostname is `lc.lzezelj.com`. The planned public name
is `lzrelay.lzezelj.com`; these instructions do not imply a production cutover
has already happened. The repository and Google display branding can be renamed
independently of DNS, OAuth callback registration and container configuration.

1. In Cloudflare, add `lzrelay` pointing to the same origin server as `lc`,
   retaining the existing proxy setting and Full (strict) TLS configuration.
   Use the configured origin target, not an IP returned for a proxied hostname.
2. In the existing Google web OAuth client, add the exact authorized redirect
   URI `https://lzrelay.lzezelj.com/api/auth/callback/google`. Retain the old
   callback during the transition. If JavaScript origins are configured, add
   `https://lzrelay.lzezelj.com`; this server-side Auth.js flow does not itself
   require that origin entry. Update old homepage/privacy links in OAuth branding.
3. On the server, edit only these values in the existing ignored
   `.env.production`:

   ```dotenv
   APP_DOMAIN=lzrelay.lzezelj.com
   AUTH_URL=https://lzrelay.lzezelj.com
   ```

4. From `/home/lc/apps/lc`, validate without printing interpolated secrets, then
   recreate the two containers so they receive the changed runtime environment:

   ```bash
   sudo docker compose --env-file .env.production -f compose.production.yaml config --quiet
   sudo docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --force-recreate --wait --wait-timeout 120 app
   sudo docker compose --env-file .env.production -f compose.production.yaml up -d --no-deps --force-recreate --wait --wait-timeout 120 caddy
   ```

Schedule this around active usage: app recreation briefly interrupts the app
and signaling authorization API. A plain restart or Caddy reload does not inject
the new Compose environment. These two runtime values alone do not require an
image rebuild. Deploying source changes, including the license page, does require
the normal tested image build and deployment.

Keep signaling, LiveKit and TURN hostnames/settings, OAuth credentials,
`AUTH_SECRET`, database identifiers, Compose project name, volumes and backup
paths unchanged. In particular, do not run `down -v`. Changing the separate
`NEXT_PUBLIC_SIGNALING_URL` would require a frontend rebuild.

Verify HTTPS, `/api/health`, Google sign-in, a newly generated demo invitation,
text delivery and a voice call on the new hostname. Users sign in again and
grant device permissions on the new origin; browser-local preferences do not
transfer automatically. Database records and memberships remain unchanged.

The current Caddy template serves only `APP_DOMAIN`; it does not automatically
redirect the old hostname. To retain old invitation links and bookmarks, keep
the old DNS record and configure a separate HTTPS redirect preserving path and
query, either at Cloudflare or in Caddy. Verify it before removing old OAuth
entries. Avoid redirecting an in-progress OAuth callback during the cutover.

## Public and private network boundaries

| Port | Exposure | Purpose |
| --- | --- | --- |
| `22/tcp` | Public only from the administrator's IP | SSH administration |
| `80/tcp` | Public | HTTP validation and HTTPS redirect |
| `443/tcp` | Public | Application, signaling, and LiveKit control TLS |
| `7881/tcp` | Public | LiveKit ICE/TCP fallback |
| `7882/udp` | Public | LiveKit RTC media |
| `3000/tcp` | Docker-private | Next.js |
| `3001/tcp` | Docker-private | signaling service |
| `5432/tcp` | Docker-private | PostgreSQL |
| `7880/tcp` | Host-local, blocked by cloud firewall | LiveKit HTTP/WebSocket origin |
| `3478/tcp + udp` | Public | TURN allocation and fallback transport |
| `49160-49200/udp` | Public | coturn relay media range |

PostgreSQL has no production host-port mapping. Next.js and signaling are
reachable externally only through Caddy. The Hetzner firewall is the public
enforcement layer for LiveKit and SSH ports.

## Deployment lifecycle

GitHub Actions runs `.github/workflows/ci.yml` on pushes, pull requests and
manual dispatch. The `core` job installs locked dependencies with Node 24,
lints, runs the default regression suite and builds Next.js using a dummy
database URL. `Docker build` builds the full production Dockerfile without
publishing an image. `Database checks` starts disposable PostgreSQL 17, applies
the production migration runner twice to verify repeatability, then runs the
database integration tests. These independent jobs need no production secrets,
do not deploy and do not alter production data. Their first hosted result is
available after the updated workflow is pushed. Requiring checks before merging
is a separate GitHub repository rule; the workflow alone does not enforce it.

Production currently uses a manual Git-based deployment:

1. Changes are tested locally, committed, and pushed to the public GitHub
   repository.
2. The `lc` user pulls the commit on the Hetzner server.
3. Docker Compose builds the multi-stage Node.js image.
4. PostgreSQL starts and passes its health check.
5. The migration container applies pending Drizzle migrations and exits `0`.
6. Next.js and signaling start and pass their health checks.
7. Caddy starts after the application services are healthy.
8. LiveKit starts with host networking and fixed RTC ports.

The final application container runs as an unprivileged `nextjs` user. Runtime
dependencies are installed without development dependencies. Containers use
`restart: unless-stopped`, so the stack returns after a host reboot.

## Configuration and secrets

Development settings live in the ignored local `.env`. Production settings
live only in the server's ignored `.env.production`, with restrictive file
permissions. Docker Compose passes only the values required by each service.

Secrets are not built into the Git repository or Docker build context. Public
client configuration such as `NEXT_PUBLIC_SIGNALING_URL` is intentionally
embedded during the frontend build; credentials such as OAuth, database,
signaling, and LiveKit secrets remain server-side.

`ALLOWED_EMAILS` is also server-only configuration. It is a comma-separated
Google-email allowlist in the local development `.env` and production
`.env.production`; production Compose passes it only to the Next.js service.

## Rate limiting

The single Next.js instance keeps short-lived rate-limit counters in memory.
Login starts are limited to 10 attempts per IP address per 15 minutes. Message
creation is limited to 10 messages per authenticated user per 10 seconds.
Server and channel changes are limited to 10 per user per hour, and demo-account
administration is limited to 30 owner actions per hour. Signaling token
issuance is limited to 120 requests per user per minute to accommodate the
application's independently authenticated persistent, text, and direct-call
sockets; LiveKit token issuance remains limited to 30 requests per user per
minute. Rejections use
HTTP 429 and a `Retry-After` header. Error bodies also include the remaining wait
in seconds, using the same reset time, so existing client error notices explain
when an action can be retried. Chat-send rejections instead disable Send with a
countdown based on Retry-After, shared across channel and DM composers. Enter
submissions are also blocked until the deadline. Rejected sends retain the draft
and are not automatically resent. This prevents ordinary burst spam but is
not shared across processes; a multi-instance deployment must move counters to
Redis or an equivalent shared rate-limit store.

## Failure behavior

- **Signaling interruption:** WebSocket clients reconnect and resubscribe. Text
  history remains available from PostgreSQL.
- **Real-time text broadcast failure:** the database write remains canonical;
  clients recover through history reload.
- **Migration failure:** Compose does not start the application, preventing new
  code from running against an incompatible schema.
- **Application failure:** health checks expose the failure. Docker's restart
  policy restarts a process that exits, but a merely unhealthy container needs
  operator action because Docker Compose does not restart it automatically.
- **LiveKit failure:** group media and presence fail, but text chat and direct
  WebRTC use separate services.
- **Host failure:** every production component is currently on the same host,
  so Hetzner backups are the infrastructure recovery mechanism.

## Observability

Current visibility comes from:

- Hetzner CPU, disk, and network graphs;
- Cloudflare request, bot, error, and bandwidth analytics;
- Docker container health and restart state;
- application, signaling, LiveKit, PostgreSQL, and Caddy logs;
- `/api/health` and signaling `/health` endpoints.

The [owner dashboard](admin.md) includes a persistent admin action log. There is
no centralized operational log store, distributed tracing or alerting service.

## Database backups and restore

Host-side [database-backup.sh](../../scripts/database-backup.sh) provides daily
compressed PostgreSQL 17 custom-format dumps and an interactive live restore.
It uses the production Compose configuration without sourcing/printing secrets.
Defaults are checkout `/home/lc/apps/lc`, database/user `lc`, and private backup directory
`/home/lc/lc-backups`. `LC_PROJECT_DIR`/`LC_BACKUP_DIR` may override paths for
manual use and isolated tests; the supplied service/function use the defaults.
Do not point these production commands at a development database.

Repository tooling is prepared; installation on the host is a separate explicit
step. The owner reported a roughly 38 MB database, a 30 MB manual archive and
successful reads of a separately restored database on 2026-11-13. This does not
establish that the timer is installed or that production was rolled back.

### Installation and daily operation

After transferring the reviewed files to `/home/lc/apps/lc`, run as the `lc` host user
from that directory. No application deployment/rebuild is needed for these
host-side scripts. GNU Bash/coreutils, util-linux `flock`, systemd and a current
Docker Compose plugin are required. The job runs as root so no unattended sudo
password or change to Docker group membership is needed. Files are private
(directory 0700, new archives 0600); the shell restore function uses sudo.

```bash
cd /home/lc/apps/lc
bash -n scripts/database-backup.sh
sudo install -m 644 ops/lc-database-backup.service ops/lc-database-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start lc-database-backup.service
```

Check that this first job succeeded before enabling the timer:

```bash
sudo systemctl status lc-database-backup.service --no-pager
sudo journalctl -u lc-database-backup.service -n 30 --no-pager
sudo systemctl enable --now lc-database-backup.timer
sudo systemctl list-timers lc-database-backup.timer --all
```

The timer runs at **03:00 Europe/Berlin**, including timezone/DST rules, with
`Persistent=true` to catch a missed run after the host returns. The oneshot service
being inactive after a successful run is normal; inspect its result and journal.
If an invocation exceeds 30 minutes systemd terminates it and records a failure.
No external failure alert or off-server copy is configured by these files.

Final daily archives use UTC filenames `lc-<timestamp>Z.dump`. Dump output is first
written into a private `.pending-*` directory, copied into PostgreSQL's container
for `pg_restore --list`, then atomically published. The list check validates the
archive directory; it is not a substitute for periodic full restore tests.
Exec commands disable stdin/TTY attachment to avoid the silent Compose hang seen
on this host. Partial files from interrupted manual commands are not restore
candidates and are not automatically deleted by this tooling.

Only after a successful new backup, matching daily archives older than 14 days
(elapsed time, based on file mtime, with minute rounding) are removed. This is
not a limit of 14 files: multiple backups on one day are retained until they age
out. Failed jobs do not rotate archives. Rescue archives (`before-restore-*`) are
excluded and require manual review/removal. The shared `flock` rejects concurrent
backup/restore operations. Free-space preflight reserves 1 GiB plus estimated
copy space; restore additionally budgets against archive size. Compression and
concurrent growth mean these estimates cannot guarantee against disk exhaustion.

### Restore by date

Enable the shell function once in the `lc` user's Bash configuration (without
sudo; this is that user's configuration):

```bash
grep -qxF 'source /home/lc/apps/lc/ops/lc-backup-shell.sh' "$HOME/.bashrc" || printf '\nsource /home/lc/apps/lc/ops/lc-backup-shell.sh\n' >> "$HOME/.bashrc"
source /home/lc/apps/lc/ops/lc-backup-shell.sh
```

Then use `restore "2026-11-13"`. A function rather than a simple alias forwards
the date argument safely. Dates mean **Europe/Berlin calendar dates**; filenames
show UTC. Matching archives are listed with sizes. Several matches require a
numbered choice, followed by the exact typed confirmation `RESTORE YYYY-MM-DD`.
Invalid dates, noninteractive use, symlinks and `.partial` archives are rejected.
The function does not grant message inspection through the web application.

Restore intentionally changes production data only after that confirmation:

1. Check space and fully restore the archive into a new isolated staging database
   using `pg_restore --single-transaction` (fail atomically on errors).
2. Stop `app`, `signaling` and `livekit`; the website is unavailable and group
   calls disconnect. Existing direct peer media is not guaranteed to stop merely
   because signaling stops. Use a planned maintenance window with no active calls,
   deployments, migrations, external SQL writers or restarts of the stopped services.
3. Save a validated `before-restore-*` rescue dump after stopping app writers.
4. Block connections to the current `lc`, terminate remaining database sessions,
   then transactionally rename it to `lc_before_<operation>` and staging to `lc`.
   The previous database stays present with connections disabled.
5. Explicitly run the deployed image's migration service with `--no-deps`, then
   start LiveKit/signaling/app and wait up to 120 seconds for service health.
   `docker compose start` alone would not rerun migrations. Use an image at least
   as new as the archive's schema; forward migration does not downgrade schemas.
6. Check website health, login, representative history and uploaded media. No
   credentials or message content are printed by the tooling.

The backup is a historical snapshot: later accounts/messages/access changes can
disappear and revoked permissions can return. It is not end-to-end encryption.
Server `.env.production`, deployment configuration and PostgreSQL cluster roles
are separate recovery prerequisites; `pg_dump` does not recreate those.

### Failures, rollback and cleanup

Before downtime, failures clean up the generated staging database and leave live
services untouched. Once shutdown begins, failure cleanup attempts to stop all
three services (including a partially successful restart), reports any stop
failure and prints the recovery database name if switching was attempted. Do not blindly
restart against an old or partly migrated schema. Database/migration failures
must be investigated; inspect the systemd journal or command output without
publishing private data. No automatic rollback guesses which state to preserve.

If switching never happened but connection admission was disabled, the live
database may still be named `lc` with `datallowconn=false`. Inspect names/flags
from the `postgres` maintenance database before re-enabling connections. If
switching succeeded, retain the failed/restored `lc` and rename the printed
`lc_before_*` database back to `lc` during maintenance, then set
`ALLOW_CONNECTIONS true` on that database and check schema/image compatibility
before starting services. These recovery steps are deliberate operator actions;
do not drop either database before deciding which state is authoritative.

After a successful restore and verification, manually remove the exact retained
`lc_before_*` database using `dropdb -U lc <printed-name>`, and review old
`before-restore-*` archives. Never use `lc` as the cleanup target. Retained
databases/rescue files consume disk until reviewed. Normal exit/signals clean up
only generated pending/container archive paths; a host crash/SIGKILL can leave
staging databases or temporary files requiring manual inspection.

Local archives share the host's failure boundary. Hetzner server backups remain
enabled; a separate encrypted off-server database copy and external failure alerts
are still future work. Monitor disk usage as media grows; the first 30 MB archive
is a measurement, not a size limit.

### Tooling validation

`bash tests/database-backup.test.sh` exercises failed exports/validation, disk and
lock refusal, safe retention, date/terminal checks, cancellation, staging/rescue
failure, migration/restart failure and operation ordering using mocked Docker. Its
interactive checks need Linux util-linux `script`; CI runs these on Ubuntu.
`bash tests/database-backup.integration.sh` requires a non-root Linux user and
PostgreSQL 17 tools. It creates its own temporary cluster, verifies real export,
staging restore, database renaming, media bytes and retained rollback state; it
does not use `DATABASE_URL` or production. Application stop/start/migration calls
are mocked there, so actual host service integration still needs installation
verification. The default app/database suites and production build also apply.

## Current limitations and trade-offs

- The CAX11 and all services on it are a single point of failure.
- CI validates tests, database migrations and the production image build;
  deployment remains manual with no automated approval or rollback pipeline.
- PostgreSQL is a single instance with no replica. Host backup/restore tooling is
  provided above; timer activation, off-server copies and external failure alerts
  require host/operator setup and are not established by repository changes.
- The signaling service stores rooms in process memory and cannot be scaled
  horizontally without shared state or a message broker such as Redis.
- LiveKit is a single node and has no Redis-backed multi-node routing.
- Direct WebRTC calls depend on the single-host coturn service whenever a
  peer-to-peer ICE route cannot be established; that relay has no regional
  redundancy.
- LiveKit has UDP and ICE/TCP but no TURN/TLS relay for highly restrictive
  networks.
- Signaling admissions and 30-second account authorization refreshes require the
  application and PostgreSQL. Explicit removals clear permissions immediately;
  missed events/account expiry are enforced by the next refresh (plus its maximum
  five-second lookup time). Failed authorization closes sockets. See
  [authorization](authentication.md#signaling-authorization). Self-hosted LiveKit
  credential replay remains a separate documented media-service limitation.
- Monitoring is mostly manual.
- Rate-limit counters are local to one Next.js process and reset on restart;
  they are not suitable for horizontally scaled application instances.
- Expired rate-limit entries remain in the process map until reused or the
  process restarts, so memory tracks distinct account/IP keys over its lifetime.
- Account-message management queries remain unpaginated and can become expensive
  with large histories. Ordinary conversation history uses cursor pages; the
  Friends endpoint reads only bounded previews rather than full message histories.
- Demo-account expiry removes server access but intentionally retains the user
  and message records until an authorized user explicitly deletes messages or
  a later account-deletion workflow anonymizes them.

These choices are appropriate for a small portfolio deployment: they keep cost
and operational complexity low while preserving clear service boundaries.
The repository-wide cleanup review, complete file inventory, retained candidates
and verification limits are recorded in [PROJECT_AUDIT.md](../../PROJECT_AUDIT.md).

## Scaling path

If LC needed to support a larger public workload, a reasonable sequence would
be:

1. Add external monitoring, structured logs, alerts, and tested PostgreSQL
   logical backups.
2. Add TURN over TLS on port 5349 and measure call success, bandwidth, and relay
   cost; the initial coturn deployment supports TURN over UDP/TCP on port 3478.
3. Move PostgreSQL to a separately backed-up host or managed service.
4. Add Redis for shared signaling presence and LiveKit multi-node coordination.
5. Run multiple stateless Next.js and signaling instances behind a load
   balancer.
6. Run multiple LiveKit nodes selected by region and room placement.
7. Extend the CI image build to publish immutable, versioned images and add
   an approved deployment workflow with rollback.

The main scaling distinction is between the control plane and media plane.
Next.js, PostgreSQL, authentication, and signaling coordinate identity and
state. LiveKit carries bandwidth-intensive group media. They should be measured
and scaled independently.

## Source files and validation

- [compose.yaml](../../compose.yaml)
- [compose.production.yaml](../../compose.production.yaml)
- [Caddyfile.production](../../Caddyfile.production)
- [Dockerfile](../../Dockerfile)
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

Relevant tests: [README.md](../../tests/README.md).

Follow the CI/test guide and the checks for the affected service. Deployment remains manual and requires explicit authorization; this documentation does not authorize production changes.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
