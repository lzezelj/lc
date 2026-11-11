# Media capture and audio processing

Camera/screen capture and rendering, mirroring/fullscreen, microphone processing, personal playback, device controls and local media tests.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Voice sessions and transports](voice-and-media.md), [Server soundboards and join sounds](soundboards.md), [Workspace UI and navigation](ui.md).

## Screen sharing, call tiles and camera preferences

Screen capture is requested only after a participant selects Share screen in a
connected call. A shared setup dialog offers 720p, 1080p (default), 1440p and 4K
with 30 fps (default) or 60 fps before the browser's source picker. Direct capture requests the chosen
resolution, and its help tooltip explains that selecting 4K cannot add pixels
to a lower-resolution source. Audio capture is requested alongside screen video;
the browser picker and OS determine whether tab, window or system audio is
available and enabled. Shared audio capture requests stereo without echo
cancellation, noise suppression or automatic gain control. Group publication
uses a 192 kbps stereo audio preset with DTX disabled; direct audio uses a
192 kbps sender ceiling and marks captured audio as music. These requests avoid
speech processing and silence suppression changing shared content, but browser
capture, codec negotiation and network conditions still determine actual quality.
Direct calls reserve a second audio transceiver for
screen audio, separate from the microphone, and play it through a second stable
audio element in CallMediaProvider. Silent placeholders added with addTrack keep
the slots reusable while answering offers, including microphone permission
fallback; replacing or stopping a screen track preserves the microphone slot.
Group calls publish LiveKit ScreenShareAudio
and distinguish that source from microphone audio. Each viewer has a per-stream
volume/mute control at the bottom right, revealed on hover or keyboard focus;
its gain multiplies the main output volume and Deafen silences both sources.
Screen audio is audible only while its video is visible in the opened media
panel: Watch focuses that stream, and opening the joined voice channel shows
the grid. Closing the panel, hiding the tile or focusing a different video
silences that screen without stopping voice audio or capture/publication.
Local previews remain muted. Starting a share plays a short notification tone
for the sharer and connected listeners; stopping sharing plays a descending tone.
Explicit microphone mute/unmute, deafen/undeafen and camera on/off actions play
distinct short local confirmation tones through `call-sounds.ts` in both native
and LiveKit calls. Each reverse action uses the corresponding reversed tone.
These synthesized cues go directly to local output, including the deafen
confirmation, and are never published to other participants. Failed capture or
publication, reconnects and automatic microphone muting do not trigger them.
Participant camera and bordered Watch shortcuts
open the media panel, reveal and focus that participant's matching tile.
Direct calls expose the camera shortcut only while the outgoing video is a
camera; while sharing, their single video sender carries the screen instead.
Direct capture requests the chosen
maximum dimensions; group calls pass the resolution to LiveKit. Actual quality
depends on browser support, the source and available bandwidth. In direct calls
screen sharing replaces the participant's
outgoing camera track on the existing peer connection, then restores the camera
when sharing ends; the authenticated signaling socket relays any required
renegotiation and screen-presence state, but never the captured media. In group
calls the browser uses LiveKit's native screen-share publication, so camera and
screen can be published as distinct tracks and forwarded by the SFU. Closing
the browser picker stops the share and clears presence in both call types.
The call grid includes name-only tiles for participants without video. Voice
channel clicks join with that grid closed; clicking the already joined channel
opens the grid. Local camera and screen tiles start hidden; Show yourself reveals
both, and Hide yourself hides them again without changing outgoing media. Local
previews are muted; LiveKit renders screen and camera as separate tiles,
while direct calls preview the screen in the outgoing-video tile during sharing.
Starting a screen share opens the call grid, respecting local tile visibility; later
navigation can hide the grid without stopping the share. Channel renaming is
available to server owners through a channel context menu.
LiveKit camera previews select the camera publication by source, independently
of screen publication order. Leaving invalidates the active room before stopping
capture and detaching tracks; late media callbacks cannot reannounce membership.
Pending token/capture operations are discarded when their join or room is obsolete.
Each call tile can be hidden locally and restored individually from Hidden
windows. Hiding changes only rendering: media elements remain mounted, audio
continues, and publishing/presence and other participants' views are unaffected.
Tile visibility lasts for the call and uses separate camera/screen identifiers.
The Hidden windows menu and Show/Hide yourself control are hidden while a single video is focused and return
when the grid is restored.
Video overlays show actual pixel dimensions without a duplicate height label,
with transfer rate, FPS and ping below. Fullscreen targets the selected video
tile, retaining its media element and audio connection. Names, grid controls and
other overlays are hidden there; a small information button reveals stream
identity, dimensions and available network statistics on hover or keyboard focus.

The client keeps the camera resolution preference in browser storage (720p by default). Camera menus
and Voice/video settings expose the same 480p–4K choice, requesting up to that
size at 30 fps (default) or 60 fps. Frame rate is saved alongside camera resolution.
Direct calls apply constraints to active capture; LiveKit
restarts only the camera track. Camera previews use those same preferences.
Both call paths set matching sender frame-rate and resolution-based bitrate ceilings.
At 60 fps, encoders prioritize frame rate over resolution and screen capture uses
the motion content hint; 30 fps prioritizes resolution. Capture constraints are
requests: browsers, source hardware, codecs, bandwidth, and LiveKit adaptation
can reduce delivered frame rate. Static screen content may produce fewer frames.

## Microphone capture, processing and device tests

The microphone can be muted before joining, and that choice is retained across
calls during the current app session. Direct capture disables the track before
publishing; a muted group join keeps microphone capture off until unmuted.
The headphones control deafens both call playback and microphone transmission,
preserving the user's independent mute preference when undeafened. Deafen is
included in authenticated voice-presence updates for direct and group channels,
so participants see a headphones indicator alongside the muted microphone.
The viewer's own row derives mute/deafen from local controls immediately,
independently of signaling echo. The authorized LiveKit fallback snapshot
includes user IDs so this also works before signaling arrives; fallback results
cannot replace an authoritative channel snapshot already received by WebSocket.
All four participant indicators share one bordered style and centered alignment.
It is a local audio preference and does not deafen other participants. Deafen is
session-local and also closes the shared microphone gain gate, including when
capture finishes after the toggle. Group microphone updates are serialized, and
mute intent is committed before awaiting LiveKit; callback-only renders cannot
restore an older mute value. The red microphone button, processed track enable
state and published voice presence follow that same intent, including unmute.
Remote-track volume updates do not detach audio playback. Device choices are
grouped in dropdown sections, with saved input/output volume (0–100%) and output
selection. Input volume scales the gated outgoing track without changing the
voice threshold. Direct playback uses the persistent audio element's volume and
sink; group playback uses LiveKit remote-track gain and room audio-output
switching. Output selection requires browser support for media-element and
AudioContext sinks; unsupported browsers retain the system output and volume
controls. These are application audio levels, not hardware mixer controls.
The idle footer uses the same microphone/device control as a joined call.
Both microphone menus expose the same device, volume and processing-mode controls,
including before joining. The microphone and output dropdowns use the channel
sidebar width, fixed positioning and an elevated stacking layer so chat content
cannot cover them. The old restart and overall-processing actions are removed.
The full call footer appears as soon as joining starts, with Connecting to the
channel shown until room joining and initial microphone setup finish (including
receive-only fallback). Media/device actions are disabled during setup, while
Disconnect remains available; connection diagnostics appear once ready. Direct
rooms remain ready while waiting for another participant; readiness does not
depend on remote video, diagnostics, or a second participant arriving.
Channel highlighting follows the visible workspace: text channels remain
highlighted during voice-only use; opening the call grid highlights its voice
channel and clears the text highlight.
Microphone transmission passes through on-device RNNoise and a Web Audio volume
stage before WebRTC encoding. When RNNoise is active, no additional loudness gate
cuts its output: quiet speech already attenuated by the denoiser must remain
audible. Manual mute/deafen and input volume still apply. Browser fallback retains
the locally saved threshold (default -50 dBFS), 10 dB hysteresis and 350 ms release.
Direct
calls publish its output track; group calls install the gate as a LiveKit audio
processor before publication. Device changes rebuild the graph, and leaving stops
the graph and capture. The shared context requests 48 kHz for RNNoise; unsupported
sample rates, module/initialization errors and runtime processor failures retain
or reconnect browser noise suppression instead of silencing the call. RNNoise
loads only in RNNoise mode. The microphone menu and Voice & video reuse a
Raw / Browser / RNNoise selector, saved as `lc.microphoneMode`. Raw disables LC
suppression, echo cancellation, automatic gain control and the threshold gate;
input/output volume and explicit mute/deafen remain active. Browser enables
browser suppression/automatic gain and the saved transmission threshold. RNNoise
uses the neural model without an additional loudness gate, falling back to Browser
if it cannot start. Initial capture and live graph changes use the same mode.
Voice & video has an independent Echo cancellation
checkbox, saved as `lc.echoCancellation`, enabled by default. Capture constraints,
active RNNoise initialization and browser fallback all honor that preference;
changing it updates active graphs without replacing their published output.
Raw temporarily bypasses this preference and disables its checkbox; returning
to Browser or RNNoise restores the saved echo choice.
Preference events update every active microphone graph,
including the settings test, without recapturing or replacing the output track.
Storage events synchronize other tabs. Aborted/revised initialization cannot
reattach an obsolete filter after a toggle, and stopping removes these listeners.
Without a saved mode, retired preferences migrate in memory: overall processing
off becomes Raw, RNNoise off becomes Browser, otherwise RNNoise remains the default.
Saving a mode also updates legacy keys for older open tabs without changing the
independent echo preference.
Once RNNoise confirms readiness, browser noise suppression and automatic gain
control are disabled on the original track to avoid stacked denoisers and noise
amplification; echo cancellation follows its separate preference. Failures restore
browser suppression while preserving the echo choice. Original tracks and the published output track remain stable
while switching processing paths. The fallback gate is based on loudness, and RNNoise
is speech denoising rather than identification of the intended speaker: other
people's voices can remain.

`@shiguredo/rnnoise-wasm` is pinned to 2025.1.5. The public versioned GET
`/api/audio/rnnoise/2025.1.5` is generated at build time with the embedded WASM,
Apache license and upstream RNNoise notices; it contains library code and no user
audio or credentials. The hashed worklet asset imports that same-origin module.
The public, statically generated `/licenses` page includes the full upstream
RNNoise and wrapper license texts. A Licenses footer action opens it inside the
existing legal overlay without unmounting the application or active call; the
notices remain accessible independently of repository visibility. Voice & video
keeps permission access at the top, followed by an audio group (devices,
processing, echo cancellation, threshold and test) and a camera group (device,
resolution and test). Both tests retain a single shared lifecycle component.
Its private AudioWorklet realm supplies the worker marker required by the pinned
Emscripten build, buffers 128-sample quanta into 480-sample mono PCM frames and
adds 10 ms of buffering in addition to RNNoise's algorithmic delay. One engine
loads per context and each capture owns a denoise state. Readiness/cancellation
checks prevent late loading from reconnecting stopped capture. Stop releases
model state and acknowledges cleanup before its message port closes. No audio
is sent to a noise-suppression service, and no cross-origin isolation headers,
external CDN or production infrastructure changes are required.
Voice/video settings show the active RNNoise/browser/off mode, a local input
meter, automatic processed mic playback after Test microphone is selected,
and a muted camera preview. The old Hear my microphone checkbox is removed.
Playback still respects Deafen, output volume and the selected output device;
autoplay failures show an error. Tests stop and pause their own playback when stopped, when the
device changes, or when the dialog closes, without stopping an ongoing call.
Deafen changes update every active gain stage immediately rather than waiting
for its periodic level-sampling timer.
Group playback and microphone processing share the gesture-unlocked audio context.
The optional `npm run test:webrtc-browser -- --microphone` check feeds generated
audio through the actual gate in headless Edge and verifies quiet blocking,
speech-level tone passage, live threshold changes, RNNoise noise attenuation,
deafen, worklet-failure fallback and output-track cleanup. Generated noise/tone
checks do not establish subjective speech quality or background-voice isolation.

## Personal participant playback

`useParticipantAudio` holds personal mute/deafen/volume choices per account and
remote user for the mounted workspace session. Voice participant context menus
expose these controls to every listener; owner-only Kick/Move remain separately
guarded in the UI and backend. Friends' notification menus include the same
playback controls, distinct from message/call notification mutes. Native calls
multiply the main output gain for microphone, screen and soundboard audio by
the participant gain. LiveKit applies it independently to each remote track and
strips the session suffix from media identities when looking up account choices.
Personal mute blocks only incoming audio; the muted person still hears the
listener. Personal deafen blocks audio in both directions between those accounts,
including soundboard and screen audio, without affecting other listeners. Native
WebRTC serializes audio sender encoding `active` changes without stopping shared
capture or renegotiating. LiveKit publisher subscription permissions deny audio
tracks to the chosen recipient while retaining video permissions; these rules are
refreshed on participant/track changes and reconnect. Permission updates run
only after LiveKit reaches `connected`; setup/reconnection retains the latest
choices without issuing premature subscription permission signals. Incoming gain applies both
choices immediately. Volume, mute and deafen remain independent. Reload/account
changes reset these temporary choices. `LocallyMuted` shows a microphone icon for
personal mute and a headphones icon for personal deafen only in the voice-channel
participant list, separately from participants' published self-mute/deafen status.
Messages, conversation headers, friends and user lists do not display these icons.

## Shared controls, camera mirroring and fullscreen

Personal audio and owner-only server mute/deafen use the shared participant menu
in both voice lists and All users. Microphone/deafen actions and equivalent menu
toggles share a 750 ms browser cooldown before side effects. Server policy remains
enforced by the existing authenticated owner-only API and SFU permissions.
Camera mirroring is a saved browser preference shared across direct, group and
settings previews. Camera device/resolution/frame-rate dropdowns are adjacent,
with the Mirror camera toggle below them; all use sibling shared DeviceSelection
wrappers so their controls have matching widths and horizontal edges. Microphone
menus and audio settings likewise place device/processing dropdowns before volume
and on/off controls. This changes layout without changing saved media preferences.
A camera-only canvas processor mirrors the outgoing pixels
for both native WebRTC and LiveKit, so receivers and local previews see the same
orientation. The LiveKit capture processor follows SDK restart/destroy lifecycle;
native capture owns both raw and processed tracks and releases both on stop.
Resolution/FPS constraints target the raw camera, and rendering follows source
frames with a maximum capture rate of 60 fps. Live toggles require no room rejoin
or screen-track replacement. Screen capture never enters the processor. Canvas
processing adds browser rendering work and can be throttled on suspended tabs.
The shared fullscreen helper toggles exit on double-click, and every fullscreen
tile exposes an Exit fullscreen button through its stream information overlay.

## Source files and validation

- [app/microphone-gate.ts](../../app/microphone-gate.ts)
- [app/camera-processing.ts](../../app/camera-processing.ts)
- [app/media-tests.tsx](../../app/media-tests.tsx)
- [app/participant-audio.tsx](../../app/participant-audio.tsx)

Relevant tests: [microphone-gate.test.mjs](../../tests/microphone-gate.test.mjs), [noise-suppression.test.mjs](../../tests/noise-suppression.test.mjs), [media-tests.test.mjs](../../tests/media-tests.test.mjs), [direct-webrtc.browser.mjs](../../tests/direct-webrtc.browser.mjs).

Run the affected media tests and `npm.cmd run build`. Use `--microphone` or `--camera-mirror` for the real browser path. Generated signals do not prove subjective speech quality or physical hardware behavior.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
