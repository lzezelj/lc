# Test coverage

Pending server invitations use the existing default server-invites suite for
owner/friend/search validation and action authentication/rate limits. The database
suite exercises actual invitation SQL and channel authorization: no access while
pending, recipient-only acceptance, sender cancellation, decline/replay behavior,
deduplication, active-account/current-owner checks and cascading cleanup. Both
suites run in their existing GitHub Actions jobs. Optional muted desktop/mobile
checks run with `node tests/direct-webrtc.browser.mjs --server-invitations` and
cover sending, inbox/outbox actions, acceptance-event deduplication, retained
background rows and account isolation.

`node tests/direct-webrtc.browser.mjs --participant-audio` provides focused muted
desktop/mobile coverage for centered personal controls/icons, server status
precedence/red icons, explicit server unmute/undeafen actions and crowded names.
Default tests reject premature LiveKit permission calls in connecting/reconnecting
states and verify that self-undeafen cannot bypass server moderation.

Crop and voice-policy regressions run in the existing default/CI suites:
account-privacy covers crop geometry; call-grid covers serial native sender
updates, incoming gain and selective publisher permissions; voice-move covers
owner authorization, independent flags, commit/event order, SFU failure reporting
and exact account identity matching; voice-session covers restricted fresh tokens.
Ownership tests cover clearing restrictions on promotion. The existing PostgreSQL
job checks default flags, per-member/server isolation and membership reset.
Optional muted desktop/mobile composer checks cover crop preview/confirmation/
cancel, separate mute/deafen controls and icons, owner menus, overflow download
suppression and a real generated-media native peer's encoding disable/restore.
These do not exercise an actual multi-account LiveKit SFU.

Image galleries and participant playback use the existing default/CI attachment
and call-grid suites: 12-file acceptance, excessive files and byte bounds, per-user
gain/mute, LiveKit session-identity mapping, and source/deafen composition. Muted
desktop/mobile composer checks cover circular avatars and fallback, smaller voice
avatars, local volume/mute and account isolation, non-owner playback menus,
up to two whole pictures plus overflow, three-column scrolling galleries, nested
preview and the explicit authenticated Download picture menu inside a modal.
Muted-person icons, borderless account/session navigation and actual browser
profile upload/re-encoding/removal/error handling are checked there as well.
The default account-privacy suite checks profile byte/dimension limits, session
ownership, authentication, authorized reads and notification-after-commit order.
PostgreSQL tests verify single-row replacement and image-removal cleanup.
PDF details/downloads remain covered.

Reconnect regressions in the default suites check protocol pings/pongs, idle
connection survival and unresponsive-client cleanup. History recovery tests run
the actual channel/DM loader effects, retaining visible rows/loading-ready state,
removing denied content, fetching the previously loaded cursor range and merging
concurrent live changes without resurrecting removed messages. These run in CI.

Conversation drafts are covered in the default `workspace-location` suite (and
the existing CI core job): channel/DM isolation, retained files, successful-send
cleanup after navigation, newer-draft protection and account reset. The muted
desktop/mobile composer mode uses the actual hook and composer to verify server,
channel and DM switching, retained pending files and clearing on workspace remount.

Typing regressions in the default signaling suite cover expiry with a controlled
clock, tab deduplication, context switches, authenticated names, channel access,
DM friendship and disconnect cleanup. Muted composer checks cover typing frames
without draft text, client throttling, view changes, blur and local expiry in
desktop/mobile layouts. Reaction-detail ownership and removal controls are also checked there.

Emoji/reaction coverage uses the existing default signaling suite, PostgreSQL
suite and muted composer/media-options browser modes. It checks authenticated
channel-only invalidations, current conversation access, actor isolation,
idempotent adds/removals, single-reaction replacement, authorized participant
details, aggregate counts and deletion cleanup. Browser checks
exercise composer SVG centering/placement, caret insertion, picker viewport bounds,
right-click React selection, server/DM participant dialogs and own-row removal,
chat-only scrolling after row growth, live count refresh and rejection of late
stale responses. Composer checks also cover hover/submenu travel, centered arrows,
right-side placement, keyboard/touch opening, cold-load reaction skeletons,
immediate cached reopening, background refresh and account isolation.
The reaction route test uses savepoints for its transactions so
API mutations cannot commit the surrounding rolled-back fixture. These database and
default tests run in their existing GitHub Actions jobs; browser modes remain optional.

Personal join-sound regressions cover member authorization, actor-scoped
writes, outsider denial, same-server selection, Default reset, own-account
preference notifications without message refresh, sender-only publication,
pending cancellation and native connection-ready announcement timing.
The existing soundboard tests run in `npm test` and
the GitHub Actions core job. The PostgreSQL suite verifies default null, deleting
the selected sound resets the choice, people/servers remain isolated, actual
routes resolve the event's member and reject outsiders, and server deletion still cascades; it
runs in the existing database job. Muted media-options browser checks exercise
the server-settings selector/save/reset and actual automatic soundboard publication.

Processing-mode regressions cover migration of retired preferences, persisted
Raw/Browser/RNNoise choices and independent echo preferences. The real-WASM check
verifies Raw requests all browser processing off and bypasses a high threshold;
desktop/mobile menu checks select and persist all three modes.

Microphone preview regressions verify automatic playback after permission,
no playback after cancelled grants, Deafen, pause/cleanup and retained captures.
Voice-activity tests cover independent saved echo constraints before capture.
The real-WASM microphone check verifies echo on/off remains honored after RNNoise
initialization and browser fallback; it emits no speaker audio.

`noise-suppression.test.mjs` runs in the default/CI suite and covers worklet
readiness, shared loading, failure/cancellation cleanup, PCM frame buffering and
late model initialization. `--microphone` now loads the real RNNoise WASM library
from a local HTTP fixture and tests generated-noise attenuation, deafen, injected
processor-error fallback and track cleanup with no speaker output. These checks
also ensure a high saved threshold cannot gate active RNNoise output. The
desktop/mobile media-options checks exercise shared RNNoise controls in the idle
and joined footer, sidebar-bounded menu geometry and stacking over chat content.
Fallback continues to use the threshold; microphone mute/deafen stay independent.
These checks
do not establish human speech quality, voice isolation or physical mic behavior.
`--chat-tools` includes the actual personal-message dialog and checks matching User
settings dimensions, two desktop columns/one mobile column, and unchanged wrapping.

Friends-list regressions now cover bounded accepted-conversation previews.
The PostgreSQL suite runs the actual route to verify incoming/outgoing selection,
160-character truncation, pending-request exclusion and deleted/attachment labels.
The muted composer browser check also decodes a selected image thumbnail before
upload and verifies removal clears it.

`notifications.test.mjs` covers typed mention boundaries/ambiguity, independent
notification preferences, expiry, actor/access checks, validated settings and
read acknowledgements. `notifications.database.test.mjs` runs the actual channel
message and edit paths with PostgreSQL: atomic mention persistence, one notification
per recipient/message, edits, durable counts, monotonic reads, independent DM
message/call preferences, membership/friendship checks and deletion cleanup.
`npm.cmd run test:db` includes both database files; use a disposable migrated
database. Fixtures roll back their own data.
`node tests/direct-webrtc.browser.mjs --notifications` runs muted desktop/mobile
checks for @ completion, keyboard/mouse/manual mentions, profile shortcuts,
the new-message divider, same-position generic/numbered indicators, independent
DM alerts, temporary mutes and acknowledgement only after reaching latest.
It also checks separate searchable Servers/People categories, retained search
queries, vertical channel-badge alignment, and right-click mute persistence for
both servers and people through the shared preference controls.
Call-context regressions execute the actual hangup/cancellation handlers and
verify LC badge/title isolation from server mentions. Real WebSocket signaling
tests verify cancellation reaches a ringing receiver outside the media room,
reject forged identity/room fields and deny cancellation to non-friends.
The mobile run retains reduced-motion emulation. These fixture checks remain
separate from a live authenticated two-device session.

`message-editing.test.mjs` covers author/access boundaries, deleted/call entries,
attachment preservation, text/rate limits, persistence-before-notification,
search scope/paging/literal matching/context, and the actual Home edit submission
handlers. Signaling tests exercise real WebSocket edit delivery and authorized
cache invalidation without unread activity. The PostgreSQL suite executes the
actual Drizzle edit/search queries in a rolled-back transaction, including JSON
filename matching, tied timestamps and private conversations.
`node tests/direct-webrtc.browser.mjs --chat-tools` runs muted desktop/mobile
checks for edit composer focus/cancel/labels, owner navigation, footer Help,
search results/paging, centered result context, the down arrow returning to live
history even from the bottom of search context, and dismissed
request rejection. Mobile runs with reduced motion. Browser fixtures use controlled
authentication/network responses; they do not prove live two-account authorization.

Run `node tests/direct-webrtc.browser.mjs --message-composer` for focused desktop
and mobile (reduced-motion) composer and attachment-preview checks without the
other workspace probes. Attachment checks cover filename overflow, size labels,
separate authenticated downloads, in-app image rendering/error feedback, dialog
bounds, focus restoration, cancellation/backdrop dismissal and message deletion.
Composer checks also retain focus through a pending send and prevent a duplicate
Enter submission. The headless workspace target explicitly emulates focus so
native focus/blur assertions do not depend on another browser target being active.

`tests/workspace-presence.test.mjs` covers automatic Away/manual status precedence,
speech and same-browser-tab activity, 10/15 minute thresholds, the shared mute/deafen
cooldown, fullscreen exit, and soundboard preferences/public playback when muted.
Database regressions validate owner-only AFK configuration, same-server group
destinations, the creation response, FK cleanup, and inviter-only acceptance
confirmation. Signaling regressions cover automatic status flags and connected
username changes surviving later presence updates. AFK timers are simulated;
these tests do not establish browser behavior while an operating system suspends
the tab or real multi-user LiveKit delivery after an AFK handoff.

Run `node tests/direct-webrtc.browser.mjs --camera-mirror` for desktop/mobile
camera processing checks. A generated two-color source goes through the same
processor as native/LiveKit camera capture, then a real local WebRTC peer pair;
remote decoded pixels verify live mirrored/unmirrored orientation. Cleanup and
the styled control are covered without a physical camera or hosted SFU. This
also checks that Friends avatars and profile information remain adjacent.
Notification gate tests cover DND, deafen, scoped mutes, self-message exclusion,
refresh silence and message/mention deduplication. Kick tests cover the delivered
reason and immediate revocation of the displayed workspace. Soundboard lifecycle
tests keep playback activity active through silence, replacement and completion.

Run `node tests/direct-webrtc.browser.mjs --list-order` for desktop/mobile camera
control widths, dropdown/toggle grouping, keyboard channel/server drag handles, real mouse/touch server dragging, canceled drops and click suppression, full
section boundaries while searching, and move-error feedback. Frame-by-frame drop
checks cover delayed saves without backward neighbor motion, stable mounted
rows, bounded scrollable overflow, and preserved scroll position in a long server
list. Above/below-list drops cover first/last placement, including scrolled lists;
horizontal departures still cancel. Database tests cover
owner-only shared channel ordering, personal server order isolation, persisted GET
order, rate limits and new rows appending. Realtime handler tests verify ordering
refreshes preserve chat history and current call/selection. After building, run
`node --test tests/list-order.http.mjs` to exercise the actual bundled channel
route over HTTP with temporary local database fixtures and authenticated
sessions. This catches helper-export failures that isolated VM tests miss.

`node tests/direct-webrtc.browser.mjs --workspace-layout` runs muted desktop/mobile
checks for legal-document Back links, portaled device-menu visibility, the wider
channel-sidebar minimum, All users keyboard/pointer resizing, soundboard ellipses
and preserved call playback. It serves only local test HTML for iframe checks.

`node tests/direct-webrtc.browser.mjs --panel-animations` verifies server/channel/
user and Friends message/profile panel show/hide transitions, mobile drawers,
mounted media elements, immediate resizing, and mobile reduced-motion behavior.

`message-attachments.test.mjs` covers bounded multipart parsing, file signatures,
video container/type limits, private byte-range responses and invalid ranges.
`node tests/direct-webrtc.browser.mjs --video-attachments` records a tiny silent
canvas clip locally and checks desktop/mobile video drafts, playback, preview
windows, picture-style video thumbnails, mixed galleries, context-menu downloads
and deletion/expiry cleanup under React Strict Mode;
all browser audio remains muted.

`npm.cmd run test:soundboard` also checks sample-accurate mono/stereo WAV trimming,
invalid ranges and local decoding limits/errors. Run
`node tests/direct-webrtc.browser.mjs --soundboard` for muted desktop/mobile
soundboard checks, including a longer source trimmed before preview/upload,
unsupported audio feedback and preview cleanup. Browser codec availability still
determines which compressed input formats can be decoded.

Moderator coverage checks upload-only soundboard capabilities, revocation during
upload, shared server quota lock order, owner-only promotion/demotion and removal,
ownership transfer to moderators, and separation from global/demo account roles.
The database suite validates migration `0029_server_moderators` in a temporary
schema. The soundboard browser mode covers promotion/demotion controls and an
open sound manager losing its upload permission after a role refresh.

Attachment tests also cover filename cleanup, per-account quota transaction
ordering/failure, and private
download membership/friendship/participant checks. The muted standard workspace
browser check exercises the shared composer: one-to-three-row growth/shrinkage,
wrapped-text scrolling, Enter/Shift+Enter, file picking, drag/drop and removal.
The database suite tests attachment soft-delete cleanup and permanent cascades
in an isolated transactional schema. These do not replace live authenticated
two-account upload/download verification.

Run `npm.cmd test` for the default suite. It needs no running application,
database, or external media service. The signaling tests start local WebSocket
servers; route and component tests use controlled dependencies.
The workspace browser checks also cover the LC introduction's automatic launch,
Next/Skip/Finish, opt-out persistence and manual reopening, account isolation,
and accessible non-interactive loading skeletons on desktop and mobile.
Tour checks also verify target outlines, viewport alignment, layout tracking,
hidden-control fallback and highlight removal on Skip.
`help-tour.test.mjs` covers merged highlight geometry and Friends-view restoration;
browser checks also cover step notifications and the inactive connected-call example.
The tour browser checks verify stable position between steps, keyboard and real
pointer dragging, and the connected-call example's bottom-left placement.
They also check the opaque guide's stacking above highlights/example controls
and the connected example's shared device controls, profile and unnamed status.

| Files | Coverage |
| --- | --- |
| `auth-account.test.mjs`, `user-handles.test.mjs` | Account/session age policy, handle formatting/allocation, and selected auth callbacks |
| `rate-limit.test.mjs` | Rate-limit windows and isolation |
| `demo-extension.test.mjs`, `direct-message-deletion.test.mjs`, `server-leave.test.mjs` | Current API handlers, authorization, persistence calls, and notifications with mocked dependencies |
| `friend-requests.test.mjs` | Metadata-only Friends listing without DM queries, activity timestamps, profile requests by user ID, handle compatibility, authentication, demo restrictions, and invalid/duplicate requests |
| `server-invites.test.mjs` | Owner-only invitation/search, active-account checks, friend-only default and explicit people mode |
| `account-privacy.test.mjs` | Confirmed account deletion, ownership blockers, credential removal, retention choices and author/sender-scoped message deletion |
| `server-ownership.test.mjs` | Confirmed owner-only transfer, membership/ownership consistency, active recipient and server-limit rules |
| `channel-management.test.mjs` | Server-scoped channel deletion, ownership, rate limits, cleanup ordering, and message grouping by stable server ID |
| `server-message-deletion.test.mjs` | Account authorization, per-server message deletion, invalid-filter rejection, all-server compatibility, and deletion broadcasts |
| `workspace-location.test.mjs` | Immediate cached server/channel restoration without a loading frame, background permission revalidation, independent channel/member loading, request cancellation and stale responses, reload restoration, destination validation, and account-scoped storage |
| `workspace-activity.test.mjs` | Read baselines/cursors, duplicate and own messages, reconnect races, deletion/revocation, cross-tab markers, server voice summaries and API membership/privacy |
| `call-context.test.mjs` | DM/server room separation, matching-conversation call layout, scoped cancellation/decline, DND badges/title/ringing, inline invitations and stable invitation expiry |
| `message-pagination.test.mjs` | Latest-50 channel/direct history, visible-conversation-only loading, bounded account-scoped session caches, navigation reuse of loaded older pages/cursors, live invalidation, reconnect recovery, failed fetch retries, hidden-view cancellation, stable timestamp ties, cursor validation, authorization, and history response races |
| `signaling.test.mjs` | Real local signaling transport, authorization, rooms, reconnection, text events, voice presence, current user presence, legacy compatibility, account-wide voice transfer, serialized admission, media-removal failures and stale cleanup |
| `voice-session.test.mjs` | Group-token admission ordering and authorization, fail-closed service errors, account-scoped SFU removal preserving the returning session, internal cleanup authentication, session-scoped call replacement, and an accessible OK confirmation in every workspace |
| `direct-negotiation.test.mjs` | Signal ordering, queue recovery, and audio statistics windows |
| `voice-activity.test.mjs`, `microphone-gate.test.mjs` | Speaking detection and microphone processing, including interruption and cleanup |
| `remote-track-view.test.mjs` | Media attachment lifecycle and output-device/volume updates |
| `media-tests.test.mjs` | Device-test capture races and cleanup |
| `call-grid.test.mjs` | Group-call rendering/actions, source selection, leave races, hidden tiles, deafen, LiveKit failure errors, online recovery preserving mute, retry cancellation on replacement/leave, and selected workspace handlers |
| `call-sounds.test.mjs` | Local mute/deafen/camera confirmations, failed capture, distinct tone envelopes and local-only output routing; LiveKit action success/failure is also covered in `call-grid.test.mjs` |
| `voice-move.test.mjs` | Owner/membership authorization, source/destination scoping, moderation limits, service-version/delivery errors, stale-client guards and immediate local connecting rows; signaling tests cover authenticated pending presence, native/group completion, cancellation, disconnect, expiry and capacity; browser checks cover menu dismissal and destination scrolling |
| `soundboard.test.mjs` | Empty boards, member/owner authorization, upload/removal, ten-second WAV and byte bounds, quota locking, client cooldown, account-wide playback permits, cache and cleanup (also runnable with `npm.cmd run test:soundboard`) |
| `database.test.mjs` | PostgreSQL cascades, message foreign keys, voice-channel types and custom-sound migration/constraints in a rolled-back test schema |

## Browser checks

These optional Windows checks launch local headless Microsoft Edge. Run each
mode separately:

```powershell
npm.cmd run test:webrtc-browser
npm.cmd run test:webrtc-browser -- --microphone
npm.cmd run test:webrtc-browser -- --navigation
npm.cmd run test:webrtc-browser -- --workspace-controls
npm.cmd run test:webrtc-browser -- --workspace-controls --media-options-only
npm.cmd run test:webrtc-browser -- --help-tour
```

- Default: real browser peer connections and generated audio over local ICE.
- `--help-tour`: focused desktop/mobile guide layout, layering, example controls,
  preference persistence and drag checks after the shared desktop media checks.
The test browser launches with speaker output muted. Generated audio, Web Audio
analysis and WebRTC transport still run, without playing test tones aloud.
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
  including silent microphone fallback, soundboard RTP with a muted microphone,
  and stopping screen/soundboard audio independently. Soundboard checks cover
  the footer dropup on desktop/mobile, keyboard actions, local preview versus
  publication, sender monitoring, speaking activity and cleanup. They also verify
  the two-column/three-row scrolling grid, shared scrollbar styling, upload dialog
  previews, nested server-settings management and preview cleanup. An actual
  LiveKit RemoteAudioTrack checks immediate receiver muting before its gain fade.
  The media-options check also exercises workspace unread dots, foreground versus
  hidden-channel reading, persisted read markers and keyboard voice tooltips on
  desktop/mobile. Signaling tests cover authorization of workspace metadata and
  initial/live voice snapshots across channels.
  Call-context browser checks cover DND popup suppression, inline Answer/Decline,
  unrelated DM/server call layouts and persistent audio on desktop/mobile.

The navigation and workspace fixtures are supporting files, not independent
test suites. The `--media-options-only` filter limits workspace checks to native
video fullscreen, separate screen audio, and desktop/mobile media setup controls,
without rerunning chat-history and unrelated workspace checks. The fixtures
do not launch the authenticated application or a real SFU.
All workspace modes, including `--help-tour`, run desktop fullscreen, screen and
soundboard RTP, immediate LiveKit receiver muting, and soundboard upload/preview
checks. These are separate logged browser commands, each with a 20-second
deadline. `--media-options-only` additionally checks the soundboard on mobile;
the identical desktop scenario runs once. Native uploaded/managed WAV previews
wait for playable data and have a four-second playback deadline with readiness,
network and media-error diagnostics. A timeout remains a failure, without retries
or skipping playback assertions.
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

Global attachment retention uses a disposable schema with small byte budgets to
exercise oldest-first deletion, recent-file protection, rollback on insufficient
eligible space, preserved message metadata, and the shared transaction lock.
The `--video-attachments` browser mode also checks 30/60 fps controls and closes
active video previews when files expire, on desktop and mobile layouts. Capture
and encoding tests verify requested frame rates, not hardware or live SFU delivery.

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
