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
| `lzezelj.com` | Next.js on `app:3000` |
| `signal.lzezelj.com` | signaling service on `signaling:3001` |
| `livekit.lzezelj.com` | LiveKit HTTP/WebSocket endpoint on host port `7880` |

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

## Current limitations and trade-offs

- The CAX11 and all services on it are a single point of failure.
- CI validates tests, database migrations and the production image build;
  deployment remains manual with no automated approval or rollback pipeline.
- PostgreSQL is a single instance with no replica or independent logical backup
  workflow.
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
