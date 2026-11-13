# LC roadmap

Reviewed against source, Git history, architecture documentation and recorded
verification on 2026-11-13. `npm.cmd test` passed: 335 tests, zero failures or skips.
Production services and external account settings were not inspected.

## Completed from the original list

| Original task | Evidence and scope |
| --- | --- |
| Secure/authenticate the custom signaling WebSocket | Signed, expiring tokens, current backend authorization and periodic permission refresh; `server/signaling-auth.mjs`, `server/signaling.mjs`, `tests/signaling.test.mjs`. |
| Real-time text instead of two-second polling | Message APIs persist before signaling delivery; reconnect history recovery is implemented. See [messaging](docs/architecture/messaging.md). |
| Reconnection handling and connection health | WebSocket heartbeat, reconnect/history recovery and group-call retry handling exist, with regression coverage. See [voice sessions](docs/architecture/voice-and-media.md) and `tests/signaling.test.mjs`. |
| Deployment configuration and HTTPS | Production Compose, Caddy, private service networking, health checks and deployment procedure exist. See [infrastructure](docs/architecture/infrastructure.md). Live deployment health was not checked in this review. |
| Rate limiting and input limits | API policies, Retry-After feedback and message/upload bounds exist. See `server/rate-limit.ts`, `tests/rate-limit.test.mjs` and [messaging](docs/architecture/messaging.md). Counters are intentionally process-local. |
| Database migrations | Drizzle migrations, production runner and CI applying migrations twice exist; `db/migrate.mjs`, `.github/workflows/ci.yml`. Backups are tracked separately below. |
| Browser/device testing foundation | Browser suites and recorded passing desktop/mobile-layout, local WebRTC, microphone and navigation checks exist. See [test guide](tests/README.md) and [recorded verification](PROJECT_AUDIT.md). Physical-device and real multi-account media checks remain ongoing validation. |
| Automated permission/authorization tests | Default signaling, account, admin, server and messaging suites plus database integration suites exist. The 335-test default suite passed during this review; database/browser suites were not rerun. |
| Admin dashboard | Owner-protected dashboard, backend moderation and persistent admin action log exist. See [administration](docs/architecture/admin.md). |
| Replace deployed signaling error telling users to run `npm run dev:all` | Fixed in commit `f414f92`: the old text was replaced by connection/service guidance in `app/page.tsx`. No matching development instruction remains in current app/server source. Deployment of that fix was not checked. |

## Remaining operational work

- [ ] Install and verify the prepared PostgreSQL backup timer on Hetzner.
  The owner created a roughly 30 MB manual database archive and read its separately
  restored records on 2026-11-13. Host tooling now provides 03:00 Europe/Berlin
  backups, 14-day retention and confirmed restore-by-date with staging validation
  and retained rollback state. Mock failure tests and an isolated PostgreSQL restore
  test (including media bytes) pass. Host timer activation remains unverified;
  encrypted off-server copies and external failure alerts remain future work.
  See [installation/recovery](docs/architecture/infrastructure.md#database-backups-and-restore).
- [ ] Monitoring and structured operational logs beyond the existing baseline.
  Health endpoints, service logs, provider graphs and the admin action log already
  exist. Centralized operational logging and external availability alerts are not
  documented as configured. Confirm external setup, then choose only the missing
  pieces; avoid credentials and private message content in logs.

See [infrastructure](docs/architecture/infrastructure.md#current-limitations-and-trade-offs)
for documented limitations. Production infrastructure changes require explicit
authorization.

## Ongoing verification, not unfinished features

- Keep relevant unit, database and browser checks passing as features change.
- Verify physical microphones/cameras, screen capture permissions, multiple real
  accounts/networks, TURN and real LiveKit recovery when those paths change.
  Local browser fixtures and mobile layouts do not establish those results.
- Hosted CI results, branch protection and the deployed revision need external
  verification; they are not evidence of missing application implementation.

## Long term (unfinished)

- [ ] Review new features for inclusion in help and introduction.
- [ ] Pinning messages. Define permissions, channel/DM scope, limits and deletion
  behavior before implementation; cover backend authorization and real-time updates.
- [ ] Add music.
- [ ] Message threads.
- [ ] Message formatting: define supported syntax and safe rendering behavior.
- [ ] Quick switcher.
- [ ] Polls.
- [ ] Server activity log: define audience and events separately from owner admin logs.
- [ ] Queue for API calls: identify the actual concurrency/rate-limit problem and
  required ordering before adding a queue. Preserve immediate interactions and
  the shared 500 ms debounce for API-backed searches.
