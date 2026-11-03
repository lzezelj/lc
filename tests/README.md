# Test coverage

Run `npm.cmd test` for the default suite. It needs no running application,
database, or external media service. The signaling tests start local WebSocket
servers; route and component tests use controlled dependencies.

| Files | Coverage |
| --- | --- |
| `auth-account.test.mjs`, `user-handles.test.mjs` | Account/session age policy, handle formatting/allocation, and selected auth callbacks |
| `rate-limit.test.mjs` | Rate-limit windows and isolation |
| `demo-extension.test.mjs`, `direct-message-deletion.test.mjs`, `server-leave.test.mjs` | Current API handlers, authorization, persistence calls, and notifications with mocked dependencies |
| `friend-requests.test.mjs` | Profile requests by user ID, handle compatibility, authentication, demo restrictions, and invalid/duplicate requests |
| `server-invites.test.mjs` | Owner-only invitation/search, active-account checks, friend-only default and explicit people mode |
| `account-privacy.test.mjs` | Confirmed account deletion, ownership blockers, credential removal, retention choices and author/sender-scoped message deletion |
| `server-ownership.test.mjs` | Confirmed owner-only transfer, membership/ownership consistency, active recipient and server-limit rules |
| `channel-management.test.mjs` | Server-scoped channel deletion, ownership, rate limits, cleanup ordering, and message grouping by stable server ID |
| `server-message-deletion.test.mjs` | Account authorization, per-server message deletion, invalid-filter rejection, all-server compatibility, and deletion broadcasts |
| `workspace-location.test.mjs` | Reload restoration through the app's startup effects, server/channel/friend validation, fresh-visit defaults, and account-scoped storage |
| `message-pagination.test.mjs` | Latest-50 channel/direct history, stable timestamp ties, cursor validation, authorization, and history response races |
| `signaling.test.mjs` | Real local signaling transport, authorization, rooms, reconnection, text events, voice presence, current user presence, and legacy server-presence compatibility |
| `direct-negotiation.test.mjs` | Signal ordering, queue recovery, and audio statistics windows |
| `voice-activity.test.mjs`, `microphone-gate.test.mjs` | Speaking detection and microphone processing, including interruption and cleanup |
| `remote-track-view.test.mjs` | Media attachment lifecycle and output-device/volume updates |
| `media-tests.test.mjs` | Device-test capture races and cleanup |
| `call-grid.test.mjs` | Group-call rendering/actions, source selection, leave races, hidden tiles, deafen, and selected workspace handlers |
| `database.test.mjs` | PostgreSQL cascades, independent message foreign keys, and voice-channel types |

## Browser checks

These optional Windows checks launch local headless Microsoft Edge. Run each
mode separately:

```powershell
npm.cmd run test:webrtc-browser
npm.cmd run test:webrtc-browser -- --microphone
npm.cmd run test:webrtc-browser -- --navigation
npm.cmd run test:webrtc-browser -- --workspace-controls
npm.cmd run test:webrtc-browser -- --workspace-controls --media-options-only
```

- Default: real browser peer connections and generated audio over local ICE.
- `--microphone`: real Web Audio processing with generated input.
- `--navigation`: actual workspace shell, group-call component, and media view
  lifecycle, with real generated audio and a mocked LiveKit room.
- `--workspace-controls`: desktop/mobile controls, layout, focus, resizing,
  device menus, settings section switching and inline saving, profile presence
  and message actions, and hover behavior in a workspace fixture using app
  components and styles. Also checks chat's initial bottom position, older-page
  loading and anchor preservation, incoming-message scrolling, and thread changes.
  Also covers selected-video fullscreen, stream volume controls, resolution help,
  and separate screen-audio RTP delivery through real local peer connections,
  including silent microphone fallback and stopping screen audio independently.

The navigation and workspace fixtures are supporting files, not independent
test suites. The `--media-options-only` filter limits workspace checks to native
video fullscreen, separate screen audio, and desktop/mobile media setup controls,
without rerunning chat-history and unrelated workspace checks. The fixtures
do not launch the authenticated application or a real SFU.
The local browser checks do not exercise physical microphones/cameras, screen
capture permissions, or multiple authenticated users.

Optional `--turn` tests relay connectivity using configured TURN credentials;
`--turn --direct-ip` additionally requires `TURN_EXTERNAL_IP`. These options
apply only to the default connectivity mode and require a reachable TURN
service. Passing local ICE checks does not establish TURN connectivity.

## Database checks

`npm.cmd run test:db` uses `DATABASE_URL` (including dotenv configuration).
Point it at a dedicated migrated test database. Test inserts and deletes run
inside rolled-back transactions. `npm.cmd run test:all` runs the default suite
and these database checks; it does not include browser modes.

## GitHub Actions

`.github/workflows/ci.yml` runs three independent jobs on pushes, pull requests
and manual runs:

- `core`: Node 24, `npm ci`, lint, the default test suite, and the production build.
- `Docker build`: the full production Dockerfile, tagged locally as `lc:ci`;
  no image is pushed to a registry.
- `Database checks`: disposable PostgreSQL 17, `node db/migrate.mjs` twice,
  then `npm run test:db`. The credentials in the workflow belong only to that
  temporary test database. No production database or GitHub secrets are needed.

After pushing the workflow and confirming all jobs pass, configure a branch
rule for `main` in GitHub repository settings. Require pull requests and the
status checks `core`, `Docker build`, and `Database checks` before merging.
Select the check names shown by the completed run. This repository setting
must be enabled separately; editing workflow YAML does not enable it.

The workflow does not include the optional browser modes, a real LiveKit call,
or deployment checks. A successful image build does not establish runtime
connectivity to production services.

## Interpreting results

Keep overlap when the failure paths differ: pure media logic, component
attachment, and browser playback catch different regressions. Legacy presence
coverage remains relevant while the signaling server supports that protocol.

Some component tests extract current functions with TypeScript and use a
one-render hook harness. They assert rendered states and recorded actions;
they do not establish React reconciliation, cross-user isolation, or live SFU
behavior. The browser lifecycle checks complement those tests.

Session-age tests establish the issued-at policy, not Auth.js cookie renewal.
Future changes to renewal, real multi-user media behavior, or browser capture
permissions deserve integration coverage at those boundaries.
