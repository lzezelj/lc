# Server soundboards and join sounds

Upload/trim/storage, quotas, authorization, metadata/audio caches, playback permits, transport mixing, lifecycle and join sounds.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Media capture and audio processing](media-and-audio.md), [Voice sessions and transports](voice-and-media.md), [Servers, channels and presence](servers-and-presence.md), [Database and persistence](database.md).

## Server soundboards

Each server starts with an empty soundboard. Metadata and uploaded WAV audio are served by
`/api/servers/{serverId}/soundboard`, with a `clip` query for audio. Both reads
validate the current Auth.js session and PostgreSQL server membership. Responses
are private/no-store; there are no public clip paths or built-in sounds.
Server owners and moderators open a shared Add custom sound dialog from the call dropup or the
Soundboard section of server settings. Removal is available in server settings,
not on call tiles. POST accepts a raw WAV body and name query; DELETE accepts
a custom clip ID. Uploads permit current owner/mod memberships; removal remains
owner-only. Both limit changes to 20 per user per minute, lock the shared server
row before the actor membership, and recheck authorization before writing. The
shared server lock serializes uploads by different moderators so the
20-custom-clip server limit cannot be exceeded. Metadata exposes separate
`canUpload` and `canManage` capabilities. Members can read metadata and audio.

Custom audio and metadata live in PostgreSQL `server_sounds`, with server-delete
cascades, a server index and constraints on name, byte length and duration. WAV
uploads are limited to 2 MiB and 10.01 seconds of 16-bit PCM mono/stereo at
8–48 kHz. The API bounds the streamed request even without Content-Length and
validates the RIFF format, chunk sizes, sample alignment and duration independently
of the extension, MIME label or client. Metadata queries never select audio bytes;
clip bytes are fetched for bounded preloading or playback through the same membership-protected route.
Immutable random clip IDs are cache versions. This bounded first implementation
keeps audio in existing database backups without adding filesystem volumes or
object storage. It stores up to 40 MiB of custom audio per server. Compressed
formats are accepted only as local upload sources; stored clips remain PCM WAV.
Clip renaming and editing already stored clips are not implemented.

The shared upload dialog trims new sounds locally. Source files may use any audio
format supported by the browser decoder (including MP3), up to 25 MiB and five
minutes, mono or stereo. `app/sound-trim.ts` decodes with an offline 48 kHz audio
context, checks duration after decoding, and encodes the chosen sample-aligned
range as 16-bit PCM WAV. Decoding temporarily holds the full source in browser
memory; the duration limit is checked after decoding, so encoded size alone does
not bound peak decoder memory. A waveform track has draggable start/end handles
and a draggable selected region, with keyboard support and precise number inputs.
All controls keep a nonempty range within the source and clamp the UI selection
to ten seconds, with start/end values displayed to two decimal places. Migration
`0028_sound_duration_margin` raises the database duration constraint to 10010 ms;
API validation also accepts 10.01 seconds, leaving a small rounding margin.
The enabled-by-default Preview after moving start option restarts the selected
clip after pointer release, keyboard release or committing a number input when
the start changed. It does not autoplay on intermediate drag updates or file load.
Preview plays the exact resulting WAV using the existing local
output/deafen controls. Only that WAV is uploaded; the original source stays
local. Replacing a file or closing the dialog ignores stale decode results.
The existing raw-body API, independent server validation, authorization, quotas,
immutable clip IDs and PostgreSQL storage remain authoritative and unchanged.

Opening the board loads metadata and preloads its first six tiles sequentially
within a 4 MiB budget. Conservative duration-based byte estimates avoid evicting
earlier tiles. Both public and preview decoders are warmed without playing audio
or requesting permits. Closing the board or changing servers cancels subsequent
work; one in-flight download may finish into the bounded cache. Other sounds
remain available on demand.
A server-and-version-keyed memory LRU holds at most 24 clips and 4 MiB of encoded
audio. Each player reuses decoded buffers by encoded-buffer identity and audio
context; weak keys release cache ownership when the bounded encoded LRU evicts
the clip or the player/context is discarded. Failed decodes can be retried.
Published playback prepares audio and requests its permit concurrently, then
waits for both before starting audio. Every play still requests
a fresh permit, including decoded-cache hits. Stop/replacement generation checks
discard late results. Preview skips the permit and remains local-only.
Opening a connected call's board prepares one silent destination track and its
native/LiveKit publication, including the sender's local monitoring element.
Consecutive clips replace only the buffer source and reuse that publication.
Natural completion, board closure and navigation retain readiness. Microphone
mute, leave, peer replacement and final disconnect release it using the existing
stop paths. Late publications clean themselves up after teardown. The next
open/play can prepare a replacement. Idle readiness never sets speaking or the
musical-note indicator; the clip lifecycle owns those signals.
The call's captured server ID,
rather than the viewed workspace, determines the board. Friend calls have no
server board. The board opens as a dropup directly above the call controls,
matching the footer width. Its two-column tile grid shows three rows (six sounds)
with further rows scrolling vertically using the application's shared scrollbar
styles. Names and the Preview icon are centered. A search input filters sound
names. Clicking a sound publishes to the call; the separate Preview icon appears on hover or
keyboard focus and remains visible on touch devices. Published sounds also play
locally for the sender; Preview uses a separate local-only player and
never publishes or announces speaking. The compact mute icon sits alongside the
volume slider. Navigation and closing the board do not stop an active clip.
Reopening a loaded board keeps its tiles visible while metadata refreshes, rather
than resetting it to an empty loading state. Upload and settings removal update
their own lists immediately. Server settings manages the viewed server, while
the call dropup and its upload dialog stay scoped to the active call's server.
The upload dialog supports file preview before saving and authenticated preview
of the uploaded clip after saving without closing the dialog. Server settings
also provides local preview. These native audio controls use temporary Blob URLs
and the same bounded audio cache as call playback, with the selected output
device/volume and Deafen. Dialog/preview teardown pauses playback and revokes
the Blob URL; it never publishes tracks, announces speaking or tears down calls.
Server settings selects each member's personal join sound from that server's
soundboard. Migration 0018 moves the previous shared choice into existing
memberships; migration 0019 removes the custom leave field. Join choices remain
in nullable `server_members.join_sound_id`, reset to Default on sound deletion.
The member-authorized PATCH `/api/servers/{serverId}/join-sound` validates the
server/clip association and updates only the signed-in member. On save it emits
`voice-sounds-changed` through the authenticated per-user event path to that
account's tabs/devices. The client merges only sound metadata into server state:
no conversation cache clearing, channel/member loading, signaling-token refresh,
inbox refresh or other-member broadcast. Actual server structure changes retain
the existing broad server-updated path.

An arriving client resolves its personal choice and publishes a custom join
through the exact manual soundboard path: authenticated play permit/cooldown,
cached WAV decode, dedicated soundboard track, activity monitor and local sender
monitoring. Listeners receive ordinary soundboard RTP and apply their soundboard
volume/mute and main output/Deafen. They never download or independently play
the custom clip. Remote join handling reads only whether a custom announcement
is selected, suppressing the generated join tone for that member.
Native channels queue the arriving second peer's announcement until the media
connection is connected, then publish once; an empty native channel has nobody
to announce to. LiveKit publishes after joining the room through the named
`lc-soundboard` track. Both reuse the manual publisher rather than injecting
audio into the microphone. Leaving/call changes cancel pending metadata/decode
and release publications. Normal generated leave tones and friend-call sounds
remain. Custom leave announcements are removed because the departing sender's
transport is being closed. Upload permits owners/moderators, removal remains owner-only, and soundboard clips
cannot be selected across server boundaries.

Migration `0033_soundboard_cooldown` adds a default-enabled per-server cooldown.
The application owner can remove or restore it for everyone in a selected server
from Admin dashboard → Servers → Server settings, through a confirmed, audited
mutation. Metadata exposes `soundboardCooldownEnabled`; the call hook loads it on
call/server changes, focus and targeted `soundboard-updated` events, canceling stale
requests. Changes notify only that server's members and do not restart calls.
The browser defaults to enforcing the delay if policy loading fails. The backend
reads the current server policy for every permit, so stale clients cannot bypass
an enabled cooldown. Local preview and the single-active-clip rule are unchanged.

Every published play, including a cache hit, requests
POST `/api/servers/{serverId}/soundboard/play?clip={id}`. The API rechecks current
membership and clip/server association, then, when the selected server's cooldown
is enabled, grants at most one play per account
per second across tabs and servers. HTTP 429 includes Retry-After. The browser
also guards rapid clicks and disables Play for one second, using call-owned state
that survives dropup closure/navigation; local Preview is independent. Playback
limits use the same single-process in-memory rate limiter as other API limits.
These are control-plane limits; a modified client can bypass playback requests
and send arbitrary RTC audio, just as with a microphone. Deletion blocks future
fetches and playback permits but does not stop an already playing clip or erase
downloaded bytes/local previews from another browser.

Each sender plays one clip at a time through a Web Audio destination independent
of microphone capture and processing. Effective microphone mute (including deafen
and server policy) stops the sender's active soundboard publication and blocks
new public playback, including join sounds; private previews remain available.
Direct WebRTC reserves a third audio
transceiver (microphone, screen, soundboard) using the same silent-slot technique
as screen audio. Microphone device replacement explicitly excludes both auxiliary
senders. The persistent CallMediaProvider owns a separate soundboard audio element.
LiveKit publishes a named `lc-soundboard` audio track with Unknown source, keeping
microphone and ScreenShareAudio publications separate. Listener soundboard volume
and mute apply to all incoming soundboard tracks, multiply main output gain and
respect Deafen, independently of the media panel. The same settings apply to
sender playback and previews through dedicated local audio elements owned by the
call hook. They remain mounted independently of the dropup. Soundboard settings
persist in browser storage and synchronize across mounted call hooks, navigation,
reconnects and tabs. Zero-volume group tracks also disable their native
receiver track before attachment and when muted, preventing LiveKit's initial
Web Audio gain fade from leaking part of a short clip. Nonzero volume reopens
the same receiver without detaching playback. This also makes Deafen and hidden
screen-audio gating immediate.

Natural completion and replacement release the clip source. Leaving, mute and
call changes also release the prepared publication. Generation checks discard obsolete
downloads/decodes and clean up late publication results. Signaling transports no
soundboard payloads. The published sound's audio detector combines with microphone
activity in speaking presence and separately announces a `soundboard` media-state
flag for a distinct musical-note indicator beside the participant's name.
That flag follows the public clip's actual playback lifecycle rather than its
audio threshold: it remains active through silent segments and clears on natural
completion, replacement, mute, leave or publication failure. Preview activity is excluded.
Successful catalog uploads/deletions broadcast a targeted `soundboard-updated`
event after the transaction commits. Clients refresh open catalogs without
resetting conversation caches or signaling authorization. Existing room membership/token checks and revocation govern
media access. As with microphone audio, a modified client can publish arbitrary
audio; the clip API protects stored catalog access, not the content of RTC media.

`npm run test:soundboard` covers API access and ownership, upload validation,
stream limits, quota/lock handling, empty boards, ten-second stereo WAV bounds,
client/server playback rate limits, cache bounds and
playback cancellation/cleanup. Call-grid tests cover separate listener gain,
mute, Deafen and combined speaking state. The workspace browser check verifies
local-only preview, sender monitoring, dropup alignment and focus, actual LiveKit
receiver muting before gain fades, search, upload/removal controls, third-track RTP audio with the microphone
muted and independent screen/soundboard stop behavior. LiveKit
publication still needs verification against a configured SFU with two clients.
Every workspace browser mode includes these desktop media checks; the
`--workspace-controls --media-options-only` mode also runs the soundboard on
mobile. Fullscreen, RTP, receiver muting and soundboard probes run as separately
logged commands. Uploaded/managed native WAV previews wait for playable data and
fail within four seconds with media-state diagnostics; this does not establish
the cause of an earlier intermittent preview timeout.
Database tests apply the sound migration in a temporary transactional schema,
verify byte round trips, invalid-record constraints and server cascades, then
roll back the entire schema.

## Source files and validation

- [app/soundboard.tsx](../../app/soundboard.tsx)
- [app/soundboard-audio.ts](../../app/soundboard-audio.ts)
- [app/soundboard-library.ts](../../app/soundboard-library.ts)
- [app/api/servers/[serverId]/soundboard/route.ts](../../app/api/servers/[serverId]/soundboard/route.ts)

Relevant tests: [soundboard.test.mjs](../../tests/soundboard.test.mjs), [database.test.mjs](../../tests/database.test.mjs), [direct-webrtc.browser.mjs](../../tests/direct-webrtc.browser.mjs).

Run `npm.cmd run test:soundboard` and the relevant database tests. Use `--soundboard` for browser lifecycle behavior, or `--soundboard-latency` for only the muted startup comparison with real browser decoding and controlled 80 ms download/permit plus 20 ms publication delays. Its three-sample medians compare sequential, concurrent and preloaded/prepared playback, not production network or remote audible latency. Real multi-account LiveKit playback still needs media-service verification.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
