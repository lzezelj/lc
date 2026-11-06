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

Deployed idle-refresh follow-up: reconnection invalidated conversation caches and
the loaders replaced visible history with an empty list before fetching, producing
the reported skeleton flash. Added 30-second signaling protocol ping/pong checks
and unresponsive-peer cleanup; the absence of keepalives is a plausible idle proxy
disconnect trigger, not a confirmed production diagnosis. Visible account-scoped
history remains mounted while recovery revalidates its loaded cursor range.
Fresh database state reconciles with concurrent live edits/removals/new messages;
permission failures clear retained content, temporary errors preserve it, and
navigation aborts obsolete work. Default/CI regressions cover idle heartbeat and
both history loaders. No deployment or proxy configuration was modified.
Formatting, all 235 default tests and production build passed. Muted call
navigation initially returned a browser playback AbortError, then passed on rerun
with stable direct audio and preserved group room/audio. Production idle behavior
still requires verification after the owner redeploys app and signaling together.

Conversation-draft follow-up: channel and DM text/files live in account-scoped
workspace state and survive navigation between servers/channels/people. Reload,
workspace unmount or account change discards them. A successful send clears only
the submitted draft snapshot, including after navigation; newer drafts and other
conversations stay intact. Failed sends retain their draft and editing uses its
separate buffer. Added default/CI state regressions and muted composer checks for
navigation, files, account isolation, late-send cleanup and reload/remount.
Formatting, 232 default tests, production build and muted desktop/mobile composer
checks passed. An initial composer run hit the already-recorded typing-blur
assertion; a subsequent run passed both layouts. A focused test-worker launch
hit sandbox EPERM and passed with the authorized rerun. No production changes.

Reaction-menu/cache follow-up: React opens on hover beside the context menu with
a centered right arrow, touch click and keyboard access, viewport fallback and a
short gap-crossing delay. Participant lists reuse the shared account-scoped,
bounded memory cache; reopening displays cached rows while checking the API in
the background. Uncached details use shared delayed skeletons with reduced-motion
support. Denied/missing details clear their cache. Composer browser regressions
cover hover travel, arrow geometry, desktop placement, keyboard/touch access,
skeletons, cached reopening, background refresh and account isolation.
Formatting, all 231 default tests, production build and muted desktop/mobile
composer checks passed. An initial mobile run hit the previously observed typing
blur assertion; the rerun passed. A sandbox browser launch also returned EPERM;
the authorized browser run passed. These results do not establish the cause of
the intermittent blur failure. No database or deployment change was needed.

Reaction-detail follow-up: chips now open a small shared dialog listing all
reactors, with removal only beside the current user's row. Migration
`0021_single_message_reaction` enforces one row per message/user in both chat
types; a new selection replaces the old emoji atomically. Existing multi-emoji
rows retain one deterministic choice, since old rows have no creation timestamp.
Details enforce the same conversation access as counts and live invalidations
update an open dialog. A message-size observer scrolls only the chat pane when
a visible message grows below it; offscreen history does not force a jump.
Help text and regression coverage reflect the new interaction. The reaction
database fixture uses savepoints so route transactions cannot commit seed data.
The local migration, formatting, 231 default tests, eight database tests,
production build and muted desktop/mobile composer checks passed. Muted
Friends/server navigation retained direct audio and the active group room.

Learning/typing follow-up: own reaction chips show a small remove X on hover or
keyboard focus. Added channel/DM typing indicators over authenticated signaling:
no draft text or SQL writes, client throttling/idle stop, server expiry, disconnect
cleanup, per-socket context replacement and per-account tab deduplication. Added
tests for expiry/tab isolation, authorized recipients, forged-name rejection,
non-friend denial and socket-close cleanup, plus desktop/mobile UI tests for
throttling, blur/navigation and client expiry. Primitive/non-object socket frames
are ignored instead of being treated as messages. Wrote LEARNING_GUIDE.md covering
20 architecture topics, alternatives, code references, limitations and exercises.
The first browser run timed out; the next reached a mobile blur assertion. The
composer runner now supplies the same browser user-gesture context as the other
interactive modes. Desktop/mobile checks then passed; this does not establish a
cause for earlier unrelated browser/tour timeouts. Existing Todo edits preserved.
Final verification: formatting, all 231 default tests, production build, muted
desktop/mobile composer/typing checks and call-navigation checks passed. All 63
relative source links in the learning guide resolve. No migration was needed for
typing, and no production services or deployment were changed.

Emoji control follow-up: replaced the text smiley trigger with a centered SVG,
moved it after the composer textarea immediately before Send, and moved reaction
selection into message right-click → React. DM menus now allow reacting to other
participants' messages while preserving edit/delete ownership checks. Empty
reaction rows disappear; existing chips remain toggleable. The composer and menu
reuse the picker, and mutation controls share the same reaction action hook.
Portal pointer/scroll handling preserves the parent menu during emoji selection.
Help text was updated. Muted desktop/mobile composer checks passed placement,
SVG centering, caret insertion, context-menu selection and reaction live updates.
Formatting, all 228 default tests and production build also passed. No database
or voice transport changes were introduced in this control-layout follow-up.

Emoji/reaction follow-up: join-sound saves no longer show transient saving text;
successful saves show "Join sound changed successfully". Added a shared searchable
emoji picker for composer insertion and reactions in server channels/DMs. Reaction
chips show counts and own participation, with per-user add/remove and dedicated
metadata invalidation across clients. Backend authorization, idempotent writes,
rate limits, bounded batch reads and stale-response guards preserve histories and
calls. Applied local migration 0020 for reaction tables and deletion cleanup.
New database regressions cover authorization, conversation boundaries, duplicate
adds, per-user removal/counts, notification targets and soft-deletion cleanup.
Browser checks cover caret insertion, picker bounds, server/DM reactions, live
updates and out-of-order response handling. Existing uncommitted work was preserved.
Verification: formatting, all 228 default tests, eight PostgreSQL tests and the
production build passed. Muted desktop/mobile composer checks passed emoji/caret
insertion, server/DM reaction toggles, live updates and stale-response rejection.
Desktop/mobile media/settings checks confirmed success-only join feedback; call
navigation retained direct audio and the group room/audio. The new default and
database regressions use existing CI jobs. No production changes were made.

Join playback/refresh correction: saving a personal join sound now sends a
`voice-sounds-changed` event only to the actor's tabs/devices and merges only
server sound metadata. It no longer invokes server-updated, clears conversations,
refetches channels/members or refreshes other users' messages. Custom joins now
publish from the arriving client through the shared manual soundboard permit,
decode, publication and monitoring path. Listeners receive soundboard RTP rather
than separately loading/playing the file. Native arrivals wait for a connected
media path and announce once; LiveKit publishes after room connection. Removed
custom leave settings and applied local migration 0019 to drop the unused field.
Generated leave tones remain. Formatting, all 227 default tests, seven PostgreSQL
tests and production build passed. Tests cover targeted saves preserving messages,
sender-only custom publication and native connection-ready timing. Existing Todo
edits and prior authorized work were preserved.
Muted desktop/mobile checks passed, including actual automatic join publication
through the soundboard path and removal of the leave selector. Navigation checks
preserved direct audio and the group room/audio. The first combined browser run
timed out in Runtime.evaluate during desktop workspace checks; a full rerun
passed. The cause remains unproven; real SFU delivery is still not established
by mocked LiveKit/browser checks.

Personal voice sounds and tour navigation (6 November): join and leave choices
are now stored per member per server. Everyone hears the arriving/departing
member's chosen server-owned clip; the authenticated API scopes writes to the
actor and authorizes listener lookups within that server. Native peer events now
carry authenticated subject IDs; LiveKit uses participant account identity.
Migration 0018 copies the previous shared join choice into existing memberships,
adds an independent leave choice defaulting to Default, and drops the old server
column. Deleting a clip resets both references. Applied to the verified local DB.
The guide captures the original view, visits Friends/server views for relevant
steps, and restores the original conversation/channel/call view on close without
leaving voice. Accounts without servers retain fallback guidance. Existing Todo
edits were preserved. Formatting, all 225 default tests, seven PostgreSQL tests
and production build passed. PostgreSQL tests exercise actual PATCH/GET actor
isolation and outsider denial as well as FK cleanup; default tests cover separate
event clips, cancellation, authenticated native subject IDs and tour restoration.
Muted desktop/mobile settings/guide and call-navigation checks passed, including
independent leave-sound selection, stable direct audio and preserved group rooms.
An initial combined run timed out in mobile `Runtime.evaluate`; the full rerun
passed. No cause is established. Actual multi-person LiveKit sound delivery still
needs real-SFU verification; the local browser group check uses a mocked room.

Member-settings follow-up: all current server members can open server settings
and change the shared voice channel join sound, including demo members. Non-owner
navigation and content expose only that section and a local selected-sound preview;
soundboard upload/removal and all other management APIs retain owner checks.
The join-sound API now authorizes membership while retaining server-scoped sound
validation, rate limits and refresh events. Shared settings button defaults use
the demo-action neutral style, standalone primary actions use blue, destructive
actions use red, and the sound preview icon has a centered square target.
Formatting, all 225 default tests and production build passed. Muted desktop/
mobile checks cover member-only navigation/content, member saves, preview icon
centering and neutral/blue/red button styles, including grouped upload actions.
The first run stopped in `verifyInvitesAndReveal` on its previously observed null
textContent read; complete reruns passed. No new migration or production change.

Server join-sound follow-up: owners can choose Default or one of their server's
soundboard clips in Server settings → Soundboard. The authenticated, rate-limited
API validates ownership and clip/server association. Migration 0017 persists the
nullable reference and restores Default on sound deletion; it was applied to the
verified local database. Native and group server calls play the selected sound
locally with output/deafen and teardown protection. Friend calls retain Default.
Default tests (225), PostgreSQL tests (7), formatting and production build passed.
New regressions are included in the existing core and database CI commands.
Muted desktop/mobile media-options, save/reset, footer and guide pointer checks
passed on rerun. The first combined browser run timed out in the desktop guide
after soundboard/save/reset and other media checks passed; its cause is unproven.
Muted Friends/server call navigation also passed, preserving direct audio and
the group room/audio through workspace changes.

Introduction follow-up: added microphone-mode guidance recommending RNNoise
with echo cancellation off as a starting point for headphones, with speaker
feedback guidance and Browser-only threshold behavior. The existing -50 dB
default and saved preferences are unchanged. New guide steps cover attachment
previews/downloads, mentions, unread indicators, notification controls/mutes,
My messages and the footer Licenses page; the skip screen now names the footer.
Formatting and six focused guide/audio tests passed. Muted desktop/mobile guide
and pointer checks passed on rerun; the first browser run timed out in
Runtime.evaluate during the mobile guide check. Its cause remains unproven.

Settings follow-up: added a public `/licenses` page containing full RNNoise and
wrapper notices, opened from the app footer in the existing legal overlay.
Microphone menus share the processing and echo controls with Voice & video.
Voice & video retains permission access at the top, then groups audio devices,
processing, echo, threshold and microphone testing before camera setup/testing.
No capture, signaling or media-processing algorithm was changed in this follow-up.
Verification: formatting, 36 focused media/menu/help tests and production build
passed. Muted media-options desktop/mobile and footer/guide checks passed on
rerun; the first run stopped in `verifyInvitesAndReveal` on a null textContent
read before reaching the microphone checks. Its cause remains unproven.

Three-mode follow-up: microphone menus and Voice & video now share a saved Raw /
Browser / RNNoise selector. Raw requests echo cancellation, suppression and AGC
off and bypasses the loudness gate, while keeping volume/mute/deafen. Browser
retains browser processing and the threshold; RNNoise retains neural denoising
without a second gate, with Browser fallback. Existing saved choices migrate,
mode changes retain the published track, and Raw temporarily disables the echo
control without erasing its saved preference. The license notices remain in
`server/rnnoise-LICENSE.txt` and the header of the served RNNoise JavaScript module,
alongside the wrapper's Apache license; no visible credits panel was introduced.
Formatting, all 223 default tests, production build, muted real-WASM mode checks,
desktop/mobile menu checks and call-preserving navigation passed.

Microphone playback/echo follow-up: Test microphone now plays processed audio
automatically, without a separate Hear my microphone checkbox. It still respects
Deafen/output settings and pauses/releases capture on stop, device change or close.
Voice & video now includes a separate saved Echo cancellation control (default on).
Both initial capture and the shared RNNoise/browser fallback graph honor it, so
RNNoise cannot silently re-enable echo cancellation. Immediate gain updates on
deafen avoid waiting for background sampling timers. Capture/playback lifecycle
tests and real-WASM browser checks cover the new behavior; physical microphone
word clipping remains a listening check, and no cause is asserted from generated
audio alone.
Formatting, all 222 default tests, production build and the muted real-WASM echo
on/off, RNNoise, deafen and fallback checks passed.

Device-menu/speech follow-up: microphone and output dropdowns now use the channel
sidebar width and elevated stacking, including idle/joined desktop/mobile views.
Restart microphone and the overall-processing action were removed, with the
same shared Noise suppression by RNNoise checkbox in the menu and Voice & video.
Shared preferences moved into a small browser module; choosing RNNoise clears an
obsolete overall-off preference so the new control remains effective. Active
RNNoise now bypasses the second loudness cutoff, while browser fallback retains
the existing threshold/hysteresis/release and mute/deafen/volume remain enforced.
The stock model itself is unchanged. All 221 tests and production build passed;
muted real-WASM checks passed attenuation with a deliberately high threshold,
toggle continuity, deafen and failure recovery. Desktop/mobile media checks
verified bounded menu geometry, stacking over content and the actual shared
toggle, and muted call navigation passed. Physical-microphone speech quality and
stacked upstream processing, such as NVIDIA Broadcast, still require listening.

RNNoise toggle follow-up: Voice & video now has a separate persistent RNNoise
checkbox. It updates the active settings test and call graphs in place, preserving
the output track, volume and mute/deafen controls. Disabled RNNoise uses browser
suppression; the existing overall processing switch still disables both paths.
Revision/abort guards reject late initialization after changing the preference,
and cross-tab storage events synchronize it. Existing microphone-test regressions
cover checkbox state and capture continuity. The muted real-WASM browser check
also covers disable/re-enable, rapid toggle cancellation and stable output identity.
The distributed static library already includes both its Apache license and
upstream RNNoise copyright/redistribution notices; no branding was added.
Formatting, all 221 default tests, production build and the muted real-WASM
toggle/deafen/fallback browser check passed. The fallback probe waits for the
timer-driven gain gate to resume after deafen rather than sampling it once.

RNNoise/message-window follow-up: the sent-message window now uses User settings
dimensions and a two-column desktop/one-column mobile grid, preserving wrapped
text and deletion confirmation. Microphone processing now loads pinned open-source
RNNoise WASM through a same-origin static build endpoint and a hashed AudioWorklet
asset. Direct calls, LiveKit's microphone processor and settings microphone tests
share this graph. Initial/browser fallback remains connected until readiness;
worklet errors restore it, cancellation prevents late attachment, and cleanup
destroys per-capture state. Browser denoising/AGC are disabled only after RNNoise
starts, while echo cancellation remains. Processing off retains the previous
unprocessed mode. Gate hysteresis/release increased to 10 dB/350 ms for word tails.
Formatting, all 221 default tests and production build passed. Added default
regressions cover readiness, shared module loading, failures, cancellation, frame
buffering and state release; they run through the existing GitHub Actions npm test
step. Muted browser checks verified actual WASM activation, generated-noise
attenuation, deafen, runtime-error fallback, stopped output tracks and the message
window dimensions/grid on desktop/mobile. Human speech quality and physical
microphone noise still require listening; generated audio does not prove those.
No production deployment or database migration was performed.

5 November UI follow-up: removed redundant destination-type labels from My
messages; pending image files now display local composer thumbnails with object
URL cleanup, and settings close icons use a centered SVG. The Friends API now
returns bounded latest-text previews for accepted conversations, with indexed
one-row lookups per direction rather than loading conversation histories.
Previews truncate text to 160 characters, mask soft-deleted text and label files;
pending requests receive no preview. Send/edit/delete paths refresh the sidebar.
All 219 default tests, seven disposable PostgreSQL tests, production build and
muted desktop/mobile composer, image-preview and chat-tools checks passed.
The PostgreSQL tests exercise the actual Friends route, latest incoming/outgoing
selection, truncation, pending-request exclusion and deleted/attachment labels.
No schema migration or audio-processing change was made; Krisp investigation
confirmed a standalone browser RTC SDK exists, with access requested from Krisp.

Notification/call follow-up: explicit friend-call hangup now cancels the incoming
invitation over authenticated presence before outcome recording clears the peer.
This reaches a ringing receiver who has not joined the voice room. Disconnect
also recognizes friend calls before media setup, and obsolete animation-frame
joins cannot restart a call after immediate hangup. Channel indicators align
vertically beside their names; server mentions no longer increment the LC badge
or browser title. Notifications settings has searchable Servers/People categories
with per-category queries. Server context menus and accepted-friend context
actions expose shared persisted message/mention or message/call mute controls.
Owner member moderation remains available alongside friend mute actions.
Formatting, all 219 default tests, production build, muted desktop/mobile
notification checks and muted call-navigation passed. One notification run
passed desktop then timed out at Runtime.evaluate during mobile; a sequential
rerun passed both sizes, without establishing the timeout's cause. New regressions
cover actual hangup ordering, real authenticated cancellation delivery to a
receiver outside the media room, badge isolation, searches, geometry and context
mute persistence. No schema, production infrastructure or deployment changed.

The mentions/notification follow-up adds a server-member @ picker, typed name or
handle resolution enforced on the backend, and atomic persisted mention records.
Generic unread dots and overlaid mention counts share a position on channels and
servers. Personal read cursors persist across devices; a New messages divider
separates previously read history from new messages. Acknowledgements require the
foreground conversation to be at its latest messages, outside search and overlays.
These are personal unread markers, not sender-visible read receipts. User settings
now persist independent server message/mention and DM message/call preferences,
including indefinite and timed mutes; DND remains an overall override.

Local migrations `0015_mentions_notifications` and
`0016_mention_deletion_cleanup` were applied, and the five new tables, mention
metadata column and soft-deletion cleanup trigger were verified. A disposable
PostgreSQL instance passed migrations twice and all seven database tests,
including actual message/edit, mention, read and preferences queries and access
denials, then was removed. Formatting, all 218 default tests, production build
and muted desktop/mobile notification checks passed. Muted navigation passed
stable direct audio and preserved group calls on rerun; the initial concurrent
run failed with a browser play() AbortError caused by a new load request. The
underlying trigger remains unproven. Browser checks use controlled network/auth
fixtures; a live authenticated two-account session was not exercised. No
production migration, deployment, commit or infrastructure change was performed.

Search-result follow-up: a reported duplicate was reproduced in disposable
PostgreSQL with `created_at` values containing microseconds. The initial search
test used whole-millisecond timestamps and missed that JavaScript Date truncation
placed the selected row among its own newer neighbors. Search now preserves the
exact UTC timestamp for context comparisons and cursor paging. Database regressions
cover unique context IDs, single target occurrence, sub-millisecond neighbors and
full-precision cursor ties in channels and DMs. Search result metadata/text are
left-aligned, with desktop/mobile geometry assertions. Formatting, all 211 default
tests, six disposable database tests, focused muted browser checks and build pass.
No schema or production infrastructure changed for this correction.

The requested edit/search and navigation follow-up is complete. Messages edit
through the normal composer, retain attachments, show edited timestamps and
propagate committed changes through authenticated signaling without unread
increments. Conversation search pages stored text/attachment names and opens a
bounded surrounding-message view. Owner demo actions now start in User settings;
Help is beside the legal links, including a compact footer when the member panel
is hidden. Existing demo dialogs are shared across Friends/server branches.
Deletion closes matching editors and clears search context; late edits cannot
restore deleted rows or overwrite a newer known revision. Local migration
`0014_direct_message_edits` was applied and its column verified. Formatting,
all 211 default tests, the production build, muted desktop/mobile chat-tool
checks and muted call-preserving navigation passed. A disposable PostgreSQL 17
instance passed the migration runner twice and all six database tests, including
the actual Drizzle edit/search queries, then was removed. Browser network/auth
fixtures and real WebSocket regressions are separate from a live authenticated
two-account browser session; no production deployment was performed.

The subsequent attachment feature adds private image/PDF uploads to channel
messages and friend DMs, plus a shared textarea composer that grows/shrinks up
to three lines and then scrolls. See `ARCHITECTURE.md` for storage, permissions,
quota and deletion details. Verification passed formatting, all 201 default
tests and the production build. A disposable PostgreSQL 17 container passed
the migration runner twice and all five database tests, including soft-delete
byte cleanup and permanent cascades; it was then removed. No existing LC database
or production infrastructure was changed. Muted focused composer checks passed
desktop and mobile/reduced-motion layout, wrapped lines, keyboard submission,
file picking, drag/drop and removal. Two broader standard workspace attempts
failed: one at the existing profile request's pending-state assertion, another
with the combined workspace Runtime.evaluate deadline after media preflight.
Their causes remain unproven; focused composer success does not establish that
the complete workspace run passes. Live two-account upload/download verification
remains separate from these route, browser-component and database regressions.
The muted navigation browser check also passed stable direct audio and retained
group-room/audio across Friends/server navigation.

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
