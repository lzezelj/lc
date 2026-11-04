# LC repository audit — 4 November 2026

## Scope and method

The starting `git status --short`, `git diff --stat`, `git diff --numstat` and
`git diff --name-only` were empty. No pre-existing edits were overwritten.
The baseline contained 184 tracked files. Filesystem enumeration also checked
for maintained untracked/ignored files outside excluded directories; none were
found. The local `scripts` and `.claude` directories contained no reviewable files.

Reviewed source, configuration, documentation, test entrypoints/fixtures, SQL
migrations, migration metadata and package/lockfile declarations. Cross-checked
TypeScript symbols, imports, string-based fixture loading, routes, scripts,
CSS selectors, dynamic classes, resource setup/teardown and test coverage.
Reference scans are evidence for candidates, not a proof that every unusual
framework or runtime reference is dead. Authentication, media lifecycle and
request/query paths received focused source review alongside the tree-wide
structural scans. This is a maintenance audit, not a live production security or
load assessment.

Excluded dependency contents, Git internals, `.next`, generated TypeScript
output, coverage/build output and secret-file contents. Environment files were
not opened for content review. The ordinary Next build can load its configured
environment; no values are recorded here. No deployment, production service,
database migration, package upgrade or infrastructure change was performed.

## Architecture preserved

Follow-up requested after this audit: the Friends-list history scan described
below has now been removed. `/api/friends` returns only friendship/profile
metadata and activity timestamps. Message previews are no longer fetched for the
sidebar; a selected friend's visible chat loads its latest 50 messages, with
older pages on demand. A retained selection in another workspace does not load
history, and leaving the visible conversation aborts its initial request. The
audit findings and verification counts below describe the original audit;
`ARCHITECTURE.md` and `tests/README.md` describe the updated behavior and coverage.
This follow-up passed formatting, all 172 default regression tests, the production
build and the muted browser navigation check. The added cases cover metadata-only
Friends queries, visible-chat loading, cancellation and stale-response rejection.

A further requested follow-up adds `app/conversation-cache.ts`: message pages
already loaded in the current workspace session are reused across navigation,
with a 40-conversation / 5-MiB serialized-payload LRU bound and account isolation.
Live updates, invalidation and reconnect recovery keep PostgreSQL authoritative.
The existing 24-clip / 4-MiB sound-audio memory cache already survives navigation.
Message and sound content is not persisted across a full page reload. The complete
inventory below remains the original audit baseline, before this added source file.
The session-cache follow-up passed formatting, all 177 default regression tests,
the production build and the muted browser call-navigation check. Its new tests
verify channel/DM reuse with older pages/cursors, live invalidation, account and
reload isolation, byte/count bounds, reconnect recovery and failed-fetch retries.

The subsequent loading-flash fix reuses the shared memory-cache implementation
for up to 20 server-view snapshots / 1 MiB of serialized metadata. Navigation
restores cached server lists and messages together before paint, while background
requests still recheck current access. Reopening a loaded soundboard keeps its
tiles during refresh. Uncached gray skeleton rows reveal after 150 ms; accessible
status remains immediate and actual content is never artificially delayed.
This follow-up passed formatting, lint, all 179 default tests and the production
build. Muted browser checks passed the focused desktop/mobile tour, the complete
media-options workspace run (including soundboard previews and cached reopening),
and call-preserving server/Friends navigation. Tests cover immediate cached
server restoration, access-denial clearing, delayed skeleton visibility and
reduced-motion behavior. These checks do not measure production latency.

- Next.js App Router owns pages and authenticated API entrypoints. Auth.js JWT
  validation rechecks the database account. APIs derive the actor from the
  session and enforce server membership, ownership or friendship before access.
- PostgreSQL/Drizzle owns durable accounts, invitations, memberships, channels,
  text/DM history and custom WAV clips. Mutations persist before notification.
- The separate Node/WebSocket service verifies short-lived HMAC tokens, keeps
  presence/rooms in memory and relays signaling and committed-message events.
- Native two-person WebRTC keeps microphone, screen audio and soundboard audio
  separate. LiveKit owns group publication/subscription; the transports have
  different lifecycle requirements despite sharing UI and audio helpers.
- `CallMediaProvider` owns stable playback elements. `WorkspaceShell` keeps
  group media in a stable sibling layer while navigation/settings/legal views
  change. Hidden video does not imply leaving or detaching voice audio.
- CI validates core tests/build, the production image and disposable PostgreSQL
  migrations separately. Compose/Caddy/coturn/LiveKit files are runtime
  entrypoints, not orphan files merely because JavaScript does not import them.

## Prioritized findings and disposition

| Priority | Evidence | Disposition |
| --- | --- | --- |
| 1 | `tests/workspace-controls.fixture.mjs` awaited native uploaded and managed WAV `play()` without a local deadline. `verifyVideoFullscreen()` secretly included RTP, LiveKit mute and desktop soundboard checks under one command deadline. | Kept every assertion; wait for playable media and bound preview startup to four seconds with readiness/network/error diagnostics. Split probes into named browser commands, each retaining the existing 20-second deadline. No retries or ignored failures. |
| 1 | The media-options driver ran desktop `verifySoundboard()` after the exact same function had already run at desktop size inside the fullscreen probe. Mobile is a different viewport and coverage. | Removed only the repeated desktop invocation. Desktop still runs once in every workspace mode, mobile still runs in media-options mode. Documented that focused tour mode also retains the desktop media preflight. |
| 2 | Sixteen class names occurred only in `app/globals.css`, with no maintained source/test references or matching dynamic producers. | Removed 43 selector branches. Shared selector declarations and their order are preserved; no active declarations, global hover animation, disabled or reduced-motion rules changed. |
| 2 | `server/demo-duration.ts` exported `DEFAULT_DEMO_DURATION_HOURS`, but there were no consumers, including namespace-based tests. Creation/regeneration already use the literal four-hour duration. | Removed the unused constant. Existing duration behavior and bounds remain intact. |
| 2 | `Home.friendAction()` serialized identical objects on both sides of an `action === "request"` ternary. | Serialize that same object directly. Request body, permissions and notifications are unchanged. |
| 2 | `SoundboardButton` separately filtered sounds for tiles and searched again for the no-results message, repeatedly normalizing the same search string. | Normalize once and reuse one filtered list only while the board is open and loaded. Same order, server scope, text and controls. |
| 3 | `/api/friends` orders and loads all the account's DM rows, then builds `latestByFriend`. `/api/users/me/message-history` and managed account history also return full histories. | Retain for a separate query/pagination change. Measure rows, bytes and query plans with representative data; preserve deleted-message previews, call entries and timestamp ties. Adding pagination changes the API/UI contract. |
| 3 | The authenticated-start effect, Friends-view effect, saved-conversation restoration and event handlers can each call `loadFriends()`. | Retain pending a request-count/race test covering initial sign-in, reload restoration, server-to-Friends navigation and live notifications. Removing a refresh based only on similar URLs could leave badges/previews stale. |
| 3 | `server/rate-limit.ts` retains expired entries for distinct keys. Entries reset on reuse, not by sweeping the map. | Record the memory limitation in architecture. Any eviction needs boundary/clock tests proving allowance and Retry-After stay identical; no thresholds or permissions changed here. |
| 3 | Group `changeMicrophone()` switches devices directly and also updates the parent ID consumed by the `[microphoneId, joined]` effect. Camera selection similarly overlaps direct switching and track-restart effects. | Retain. Capture, mute intent, device persistence and SDK callbacks must be tested together before choosing one owner. No claim that removing one call is safe for every SDK/device combination. |
| 3 | `monitorTrackVideo`, `monitorRoomDiagnostics` and native diagnostics use asynchronous interval callbacks. Clearing an interval does not cancel an already pending stats request. | Retain and consider deferred-`getStats()` teardown/overlap tests before adding cancellation or consolidating collectors. Native/group reports differ; the native callers already guard replacement-peer updates. |
| 3 | Presence broadcasts scan clients and authorized channels, and modern workspace subscriptions overlap legacy room-presence paths. | Retain protocol compatibility and access scope. Profile fan-out at representative client/channel counts before indexing subscriptions or removing a protocol. |
| 4 | Self-view state transformations and two member context-menu callbacks are exact duplicates. Internal signaling HTTP helpers also repeat headers/configuration. | Small sharing candidates, left untouched: media contexts and moderation coordinates differ, and internal helpers currently differ in fallback URL, error handling and response semantics. A blanket abstraction would hide those distinctions. |
| 4 | Route/component tests repeat TypeScript/VM and mock-query scaffolding. No identical large test-function bodies were found by the exact normalized-body scan. | Keep the assertions. A future helper extraction should preserve each suite's deliberate dependency isolation, transaction mocks and failure paths. |

The earlier preview timeout did not reproduce in the baseline standard workspace
run or in the baseline media-options desktop/mobile run. This does not establish
that it was harmless, redundant or fixed in the application. It exposed a test
diagnostic weakness, now bounded and named; recurrence should identify the
uploaded/managed preview and its media state instead of only reporting a generic
command timeout. Neither production preview code nor call playback was changed.

## Removed CSS and safeguards

Confirmed unused class families:

```text
friendsCallVideo       addFriendsModal       headerActions
renameChannel          callDiagnosticsControl userHandle
groupPlaceholder       settingsChannelList   deviceChoices
inviteMemberButton     ownerAction           inviteLink
voiceVideoModal        joiningStatus         serverLoading
revokeActions
```

Dynamic `skeleton-${kind}`, `status-${status}` / profile-status classes and
`role-${member.role}` remain. The shared `DeviceSelection` styles remain;
removing legacy `.deviceChoices` branches preserves the active
`.audioDeviceOptions` and `.settingsDeviceChoices` branches.

A PostCSS comparison against the baseline, removing only the 43 approved
selector branches, matched the final stylesheet's complete remaining rule,
at-rule and declaration tree in the same order. A separate scan confirmed the
16 removed class names have no references in app/server/test source.

CSS source size fell from 94,951 to 91,255 bytes: 3,696 bytes before compression.
This is a source-size reduction, not a measured page-load or rendering speedup.
The soundboard avoids the second predicate traversal while open; its 20-clip
server limit makes the likely saving small. No runtime latency, CPU or memory
improvement is claimed without profiling.

## Retained files, exports, dependencies and assets

- No source file, test suite, dependency or asset was deleted. No orphan
  maintained source file was confirmed after accounting for entrypoints and
  dynamic references. There are no tracked image/font/audio asset files or a
  maintained `public` asset tree. Icons are inline SVG; test WAVs are generated;
  custom sounds are authorized database content and preview Blob URLs.
- Next.js `page.tsx`, `layout.tsx`, API HTTP methods, `metadata`, `dynamic` and
  `runtime` exports are framework entrypoints. Legal routes are also linked and
  embedded through a document-name-based iframe URL. Configuration filenames are
  discovered by their tools. `next-env.d.ts` is generated but tracked and was
  retained; build-only regeneration is restored to the starting version.
- Drizzle enum/table exports remain discoverable through `schema: "./db/schema.ts"`
  and the `import * as schema` database namespace. Do not remove schema exports
  because individual application files do not name them.
- All 13 SQL migrations and seven metadata files remain. Old room/server names,
  enum transitions, the nullable-handle migration and five-to-ten-second sound
  limit migration are history, not obsolete implementations. The six snapshot
  IDs form a consistent predecessor chain; the journal includes all SQL files.
  Later hand-written migrations without snapshots do not justify deleting old
  snapshots or regenerating historical migrations.
- `tests/sound-wave.ts` is intentionally test-only; the browser bundler writes it
  under the temporary `soundboard-catalog.js` name. Navigation and workspace
  fixtures and the LiveKit mock are loaded by the browser runner rather than
  npm's default test command.
- Every production dependency has a source/runtime/tool consumer. Type packages
  are implicit compiler inputs; Next/React and Drizzle CLI packages are also
  framework/tool entrypoints. `eslint-config-prettier` and `prettier` support the
  imported recommended Prettier ESLint integration and its peer requirements.
  Lockfile root production/development declarations match `package.json`.
- `server-only` is resolved by Next's framework handling; this audit does not
  infer an orphan or introduce a dependency merely from a bare-import scan.
- `auth.ts` exposes unused server-side `signIn`/`signOut` bindings and local
  `CallTile`/`LegalDetails` types have broader export visibility than current
  consumers require. Leave these conventional API/type surfaces alone; no
  material runtime saving is established by narrowing them.
- `Todo.md` contains historical/completed items, including menu dismissal.
  Preserve the user's task notes instead of rewriting or deleting them.

## Regression coverage

Keep overlap across layers: pure gate/cache/queue tests establish algorithms;
component tests establish rendering, actions and cleanup; browser tests establish
actual DOM/media attachment, playback and RTP. API mocks test actor/scoping and
notification order; database tests establish constraints/cascades. They are not
interchangeable. Legacy server-presence tests remain while the protocol exists.

There are 28 `.test.mjs` files: 27 default suites containing 169 tests and one
separate PostgreSQL suite containing four tests. The optional browser runner has
generated-input connectivity, microphone, navigation and workspace modes. VM
harnesses do not prove full React reconciliation, Auth.js renewal, physical
device quality or two authenticated users on a real SFU. Browser fixtures also
do not establish live application authorization. See `tests/README.md` for modes.

No new product behavior was introduced. Existing request/action tests and real
desktop/mobile soundboard checks cover these small simplifications; no tests
were deleted. Future SQL, refresh-coalescing, rate-limit eviction or capture
consolidation work needs the targeted regression coverage described above.

## Complete baseline inventory

All paths below are relative to the repository. Their roles explain why they
remain, including files with no ordinary import edges. The audit adds this report
to the 184-file baseline.

| Area | Files | Review role |
| --- | ---: | --- |
| Root and CI | 21 | Build/tooling, authentication, deployment templates, project instructions/docs |
| Application outside API | 66 | App Router pages/layout, client UI, shared media/state helpers and CSS |
| API routes | 26 | Session-authorized durable state, token issuance and moderation |
| Database source | 3 | Pool/Drizzle initialization, schema and production migration runner |
| SQL migrations | 13 | Ordered historical changes |
| Migration metadata | 7 | Drizzle journal and historical snapshots |
| Server source | 13 | Signaling, validation, notifications, limits and development launcher |
| Tests and fixtures | 34 | 28 suites, browser runner, four support modules and coverage documentation |
| Auth type augmentation | 1 | Compiler-consumed session/JWT types |

```text
.dockerignore
.github/workflows/ci.yml
.gitignore
AGENTS.md
ARCHITECTURE.md
Caddyfile.production
Dockerfile
Todo.md
auth-account.mjs
auth.ts
compose.production.yaml
compose.yaml
drizzle.config.ts
eslint.config.mjs
global.d.ts
next-env.d.ts
next.config.ts
package-lock.json
package.json
tsconfig.json
user-handle.ts
types/next-auth.d.ts
app/account-deletion.tsx
app/audio-device-options.tsx
app/audio-output.ts
app/audio-window-stats.ts
app/call-context.ts
app/call-media.tsx
app/call-sounds.ts
app/call-tile-controls.tsx
app/camera-resolution.tsx
app/channel-manager.tsx
app/chat-history.tsx
app/device-menu.tsx
app/device-selection.tsx
app/direct-negotiation.ts
app/empty-state.tsx
app/globals.css
app/group-call.tsx
app/help-call-preview.tsx
app/help-geometry.ts
app/help-spotlight.tsx
app/help-tour.tsx
app/impressum/page.tsx
app/incoming-call-notice.tsx
app/invite/[token]/page.tsx
app/layout.tsx
app/legal-details.ts
app/legal-links.tsx
app/loading-skeleton.tsx
app/login/page.tsx
app/media-tests.tsx
app/message-delete-action.tsx
app/message-groups.ts
app/message-header.tsx
app/microphone-gate.ts
app/page.tsx
app/panel-toggle.tsx
app/participant-media-indicators.tsx
app/personal-messages.tsx
app/privacy/page.tsx
app/providers.tsx
app/remote-audio-volume.ts
app/screen-audio.tsx
app/screen-share-options.tsx
app/server-invites.tsx
app/server-nav-button.tsx
app/settings-members.tsx
app/settings-modal.tsx
app/settings-navigation.tsx
app/settings-reveal.tsx
app/shared-audio.ts
app/sidebar-resizer.tsx
app/sound-manager.tsx
app/soundboard-audio.ts
app/soundboard-library.ts
app/soundboard.tsx
app/stream-info.tsx
app/stream-volume.tsx
app/use-message-cooldown.tsx
app/use-workspace-activity.ts
app/user-profile.tsx
app/user-status-menu.tsx
app/voice-activity.ts
app/voice-participant-menu.tsx
app/workspace-activity.ts
app/workspace-location.ts
app/workspace-shell.tsx
app/api/auth/[...nextauth]/route.ts
app/api/channels/[channelId]/livekit-token/route.ts
app/api/channels/[channelId]/messages/route.ts
app/api/demo-accounts/route.ts
app/api/direct-messages/[userId]/[messageId]/route.ts
app/api/direct-messages/[userId]/route.ts
app/api/friends/route.ts
app/api/friends/search/route.ts
app/api/health/route.ts
app/api/ice-servers/route.ts
app/api/messages/[messageId]/route.ts
app/api/servers/[serverId]/channels/route.ts
app/api/servers/[serverId]/invitees/route.ts
app/api/servers/[serverId]/members/route.ts
app/api/servers/[serverId]/ownership/route.ts
app/api/servers/[serverId]/soundboard/play/route.ts
app/api/servers/[serverId]/soundboard/route.ts
app/api/servers/[serverId]/voice-kick/route.ts
app/api/servers/[serverId]/voice-move/route.ts
app/api/servers/[serverId]/voice-presence/route.ts
app/api/servers/route.ts
app/api/signaling-token/route.ts
app/api/users/[userId]/messages/route.ts
app/api/users/me/message-history/route.ts
app/api/users/me/route.ts
app/api/workspace-activity/route.ts
db/index.ts
db/migrate.mjs
db/schema.ts
db/migrations/0000_sturdy_jimmy_woo.sql
db/migrations/0001_closed_mikhail_rasputin.sql
db/migrations/0002_curvy_mathemanic.sql
db/migrations/0003_material_eternity.sql
db/migrations/0004_sticky_phantom_reporter.sql
db/migrations/0005_dark_white_queen.sql
db/migrations/0006_friends.sql
db/migrations/0007_handles_nullable.sql
db/migrations/0008_friend_activity.sql
db/migrations/0009_direct_call_history.sql
db/migrations/0010_direct_message_deletion.sql
db/migrations/0011_server_sounds.sql
db/migrations/0012_sound_limits.sql
db/migrations/meta/0000_snapshot.json
db/migrations/meta/0001_snapshot.json
db/migrations/meta/0002_snapshot.json
db/migrations/meta/0003_snapshot.json
db/migrations/meta/0004_snapshot.json
db/migrations/meta/0005_snapshot.json
db/migrations/meta/_journal.json
server/demo-duration.ts
server/dev.mjs
server/disconnect-user.ts
server/friends.ts
server/message-removals.ts
server/notify-server.ts
server/notify-user.ts
server/rate-limit.ts
server/remove-channel-media.ts
server/signaling-auth.mjs
server/signaling.mjs
server/sound-upload.ts
server/user-handles.ts
tests/README.md
tests/account-privacy.test.mjs
tests/auth-account.test.mjs
tests/call-context.test.mjs
tests/call-grid.test.mjs
tests/call-navigation.fixture.mjs
tests/call-sounds.test.mjs
tests/channel-management.test.mjs
tests/database.test.mjs
tests/demo-extension.test.mjs
tests/direct-message-deletion.test.mjs
tests/direct-negotiation.test.mjs
tests/direct-webrtc.browser.mjs
tests/friend-requests.test.mjs
tests/group-navigation.mock.mjs
tests/help-tour.test.mjs
tests/media-tests.test.mjs
tests/message-pagination.test.mjs
tests/microphone-gate.test.mjs
tests/rate-limit.test.mjs
tests/remote-track-view.test.mjs
tests/server-invites.test.mjs
tests/server-leave.test.mjs
tests/server-message-deletion.test.mjs
tests/server-ownership.test.mjs
tests/signaling.test.mjs
tests/sound-wave.ts
tests/soundboard.test.mjs
tests/user-handles.test.mjs
tests/voice-activity.test.mjs
tests/voice-move.test.mjs
tests/workspace-activity.test.mjs
tests/workspace-controls.fixture.mjs
tests/workspace-location.test.mjs
```

## Verification record

Baseline: 169/169 default tests, lint, TypeScript with
`--noUnusedLocals --noUnusedParameters`, standard workspace browser and
media-options desktop/mobile browser checks passed. The reported preview timeout
was not reproduced.

Final verification:

- `npm.cmd run format` and `npm.cmd run lint` passed.
- `npm.cmd test`: 169 passed, zero failures or skips, preserving every default
  regression case. Node reports its existing module-type detection warnings for
  direct TypeScript imports in tests; no package module-mode change was made.
- `npm.cmd run build` passed, including Next.js compilation, TypeScript and
  static/dynamic route generation. Build-only changes to `next-env.d.ts` were
  restored. A separate unused-symbol check passed after the build; an initial
  attempt concurrent with Next's generated-type replacement failed on missing
  `.next/types` files, so the completed build was followed by the sequential check.
- Muted headless Edge passed direct ICE/DTLS/RTP, microphone gate, persistent
  Friends/server call navigation, standard workspace controls, focused tour and
  media-options desktop/mobile checks. Microphone/default browser launching
  initially hit sandbox `EPERM`; the authorized reruns passed.
- One final media-options run timed out at `verifyHelpAndSkeletons (desktop)`
  after soundboard, receiver muting and RTP checks had passed. The focused tour
  passed independently, then the complete media-options run passed without
  concurrent build/lint/type checking. Retain this as an intermittent combined-run
  limitation; neither passing reruns nor named probe boundaries prove its cause.
- PostCSS structural comparison preserved all remaining declarations/selector
  order; complete inventory comparison matched the 184 baseline Git paths.
- `git diff --check` passed. No source files, tests, packages, migrations or
  production configuration files were removed or replaced.

Database integration/migration and Docker image jobs were reviewed but not run
locally. No dedicated disposable database target was established, and this
cleanup changes neither SQL/schema nor container inputs. No production database
was contacted for verification. TURN and a real two-user LiveKit SFU session were
not exercised. No claim is made about physical microphone/speaker quality or
production performance.
