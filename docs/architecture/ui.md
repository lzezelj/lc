# Workspace UI and navigation

Workspace restoration/caching, profiles, settings, help, loading, panels, resizing, portals and legal overlays.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Messaging and conversation history](messaging.md), [Voice sessions and transports](voice-and-media.md), [Media capture and audio processing](media-and-audio.md), [Servers, channels and presence](servers-and-presence.md), [Notifications and activity](notifications.md).

## Workspace navigation and call footer

Fresh authenticated entry and the Friends button open the Friends list. The LC
button returns to the selected direct conversation when switching back from a
server; switching workspaces retains that selection without affecting calls.
Reloads restore the last Friends tab/conversation or server/text channel from
per-account session storage in that browser tab. Startup validates saved IDs
against current server access, accepted friends and fetched channels; stale
destinations fall back to Friends or the server's first text channel. Persistence
waits until restoration finishes so initial defaults cannot overwrite the saved
destination. This stores navigation IDs only and does not resume calls/capture
after a full reload. WorkspaceShell keeps the group-call component in a
stable sibling layer outside changing Friends/server children, so navigation
preserves the LiveKit room, capture tracks, remote audio elements and call controls.
The media grid can overlay either workspace without moving the room component.
The shared profile footer appears in both views and derives its connection label
from active direct/group voice membership, rather than the currently viewed
server or a generic signaling status. Long labels truncate with a full-text
hover title.
The sidebar footer grows only during an active call: screen sharing and
actions sit above connection status/diagnostics and disconnect, with identity,
microphone/camera controls and a separate settings menu along the bottom.
Forced group-room disconnections clear the active voice selection and call UI.

## Cached navigation and loading

Server selection updates the visible workspace immediately. Visited servers
restore their own cached channel/member snapshots and message history in the
navigation state update, before a loading frame can paint. An account-scoped
`SessionCache` holds up to 20 server snapshots or 1 MiB of serialized metadata,
using the same bounded memory-cache implementation as conversation history.
Server/channel/access events, account changes and reconnects invalidate these
snapshots. A background effect still revalidates destination channels and members
independently; permission failures discard cached content. Unvisited servers
clear the old server's data rather than briefly displaying it under a new name.
Channel selection and history loading do not wait for members.
Loading indicators stay inside the workspace, keeping navigation and active
calls mounted. Switching again aborts obsolete list requests and ignores their
responses. Text-channel clicks clear the previous channel's visible history;
previously loaded message pages restore from the page-session cache, while an
uncached channel shows loading until its authorized history arrives.

## Avatars, profiles and identity updates

The shared `Avatar` renders existing profile image URLs as circles with initials
on missing/failed images. Voice-channel avatars are 20px; message/friend/member
avatars are 32px (26px in the compact conversation list). Message history, search and live message responses include
`authorImage`, while current member/friend/session images take precedence in the
workspace. A known user's explicit null picture overrides stale message metadata.
External profile images use no-referrer and bypass the image optimizer.

Voice-channel rosters render alphabetically by name, with user IDs breaking ties,
independently of presence update order or speaking activity. Participant names sit
beside their avatars with a shared compact gap. Indicator groups wrap on narrow
sidebars rather than overlapping names or adjacent controls. Speaking highlights
are local to the viewer: deafen hides remote speaking, and personal mute/deafen
and server moderation suppress affected highlights without modifying presence
broadcasts. The shared status avatar places an online/away/do-not-disturb/offline
dot outside the picture in Friends and All users, including image fallbacks.

My account groups the profile picture before display-name controls.
`ProfilePictureSettings` accepts PNG/JPEG/WebP up to 2 MiB and opens a local crop
editor with drag positioning, zoom/position sliders and a live circular preview.
Selection and cancellation do not upload. Explicit Save picture re-encodes the
chosen square to a 256px PNG; original aspect ratio is preserved within the crop.
PUT/DELETE `/api/users/me/avatar` derive the target from the session,
rate-limit updates and bound raw uploads to 512 KiB before reading them in full.
The server checks PNG signature/IHDR dimensions (maximum 512px per side), but does
not perform independent full image decoding or re-encoding. Invalid image data
cannot execute as SVG/HTML and falls back to initials if the browser cannot decode
it. Migration `0022_profile_pictures` stores one bounded bytea row per user with
replace/delete transactions, FK cleanup and a trigger clearing bytes when the
account's image is removed, including soft account deletion. Only a versioned URL
is stored in `users.image` and JWT/session metadata; bytes are not copied into
messages or tokens. Auth callbacks refresh the picture from PostgreSQL.

GET `/api/users/{userId}/avatar` requires self, accepted friendship or current
shared-server membership before returning private/no-store, PNG-only/nosniff
bytes. A targeted `profile-updated` user event updates current friend/member
metadata and invalidates server snapshots without clearing message history or
restarting calls. Other tabs of the same account also refresh session metadata.
Username changes use the same authorized profile audience and event, updating
All users, friend selections and voice presence immediately. The signaling service
updates connected account identities so subsequent presence packets retain the
new name. Picture-only events preserve names and name-only events preserve pictures.

## Permissions and conversation controls

The device permission prompt disappears once microphone and camera access are
granted; denied/revoked permission remains actionable. Sending keeps the composer
focused, and the existing Friends sidebar button becomes Back to Friends while
a direct conversation is selected.

## Demo management entry points

User settings → Admin dashboard opens `/admin` in a separate tab for the configured
owner. Demo management has moved there; its old workspace forms and overlays have
been removed. See [Application administration](admin.md) for the dashboard's
navigation, confirmation, data and authorization contracts. Help & introduction
sits beside Impressum and Privacy in the shared workspace footer.
A compact footer keeps these actions available when the member sidebar is hidden,
including mobile, without covering the composer or unmounting calls.

## Workspace panel transitions

Both workspaces have controls to toggle the server rail, channel/conversation
sidebar, and user/profile sidebar. These controls remain visible on desktop and
mobile. The server cog sits to the right of the hide-channels control.
Panel toggles animate their registered CSS width properties and opacity over
200 ms, so the grid and fixed controls move together. The mobile user/profile
drawer slides and fades. Hidden panels remain mounted, become noninteractive,
and finish hiding after the transition; media ownership does not change.
Sidebar resizing bypasses width transitions, and reduced-motion mode removes
panel animation delays.

## Responsive settings, help and message management

In Friends, the sidebar
control is labeled Show or hide messages and occupies the server-cog position.
Empty friend tabs and message histories use explanatory placeholder cards.
On narrow mobile screens the rail and user
list start hidden while channels and chat remain visible; the channel sidebar
can also be hidden to give chat the full width. The user list opens as a drawer
on tablet/mobile widths. These controls change CSS visibility only and do not
unmount the active media connection or change voice membership. Scrollbars use
the shared dark theme throughout the app, including dialogs and legal pages.
User and server settings open native modal dialogs above the workspace and call
controls without replacing the workspace or disconnecting media. Each dialog
has sidebar navigation and an independently scrolling content pane (horizontal
navigation on small screens). Account, media setup, personal messages, server
overview, channel creation and friend assignment render inside those panes
using authenticated APIs, with separate Invite friends and Invite people
sections grouped together under Invitations, friends first. Server navigation
also groups Server, People and Administration; user navigation groups Account,
Communication, Privacy and Session. Opening camera or
microphone previews and expanding settings details scrolls the dialog's content
pane toward the newly opened section's top, clamped to the available scroll range;
the workspace behind the modal does not scroll.
The footer's Help & introduction control reopens an informational,
step-by-step LC introduction. The guide shares the native modal component and
lives beside the persistent call layer, so workspace navigation and guidance
do not remount media or start capture. The guide remembers the original view,
shows Friends on its Friends step, and switches to an available server for
channel/server/mention guidance even when started in a DM. Closing/finishing
restores the previous server/channel, Friends conversation and call view. Accounts
without server access retain the available workspace and fallback hints.
It automatically opens after workspace
startup unless `lc.help.dismissed:{userId}` is true in localStorage. Next/Back
navigate the guide; Skip and modal dismissal offer a final preference prompt.
The final step and skip prompt both offer Do not show again, checked by default
when no choice has been saved. Confirming stores the explicit `true` or `false`
choice per account/browser. Manual Help always works, and unchecking the
preference enables future automatic display. This preference is not synced
between browsers/devices; unavailable storage leaves the tour usable.
Each guide step maps to visible workspace controls. A viewport-aligned SVG mask
inside the native dialog dims the surroundings and outlines the targets; the
guide card holds a fixed position across steps and can be moved by dragging its
header or using arrow keys on the focused header. It stays within the viewport
on resize; longer steps scroll inside the card instead of moving it. Resize, scroll, layout
and visibility changes update the outlines. Touching/overlapping target boxes
merge into one frame so adjacent channels and message/composer edges do not
produce double borders. The Friends step temporarily opens the actual Friends
list, preserving and restoring the previous conversation/workspace and call-view
selection when advancing or skipping; the active call stays connected.
Camera/screen/soundboard guidance includes a labelled connected-call example
in the usual bottom-left call area, aligned with the visible profile panel.
It uses disabled controls and no media capture or transport activity.
The guide's opaque surface has its own stacking layer above the spotlight and
call example, so dragging across highlighted controls cannot dim the card or
draw outlines over its contents. The example reuses `DeviceMenu` and shared icons,
shows the current profile/status, camera off, microphone/deafen and connection
controls, and omits the channel name. Neither its action nor device menu buttons
can start capture, open a selector or affect the actual call.
Hidden/offscreen controls are clipped out; fallback targets and a location hint
explain controls unavailable in the current view. Skipping, finishing or closing
the guide removes the mask, observers and positioning. Calls stay mounted.
Shared, non-interactive loading skeletons fill channel lists, both message
histories and the six-tile soundboard grid while authorized responses are pending.
Their accessible loading status is immediate, but gray rows reveal only after
150 ms. Faster responses remove the placeholder before it becomes visible; cached
navigation and soundboard reopening reuse content immediately. The delay reserves
the normal skeleton layout, does not postpone data rendering or impose a minimum
loading time, and retains reduced-motion support without pulsing.
Soundboard metadata loading is tracked separately from empty/error results and
refreshes on reopening. Skeletons have an accessible loading status, honor
reduced motion, and never stand in for clickable channels/messages/sounds.
Personal message deletion confirms inline.
My messages uses the same shared Servers/People category and search controls as
Notifications, retaining each category's search while switching tabs. The current
server appears first within Servers. Selecting a destination opens a separate
settings window containing only that account's sent messages, a content/channel
search and confirmed permanent individual or bulk removal. The message window
shares User settings dimensions and shows two cards per row on desktop, with one
column on narrow screens. Existing text wrapping is retained. The self-only
message-history API scopes every read and deletion to the session author/sender and selected destination;
it also includes soft-deleted placeholders for permanent removal. Existing chat
history pagination remains independent. Channel creation precedes the searchable
channel list; member management includes search and alternating row colors.

## Profile layout, resizing, portals and legal overlays

The right-hand Friends profile card fits within its panel including side margins,
avoiding horizontal overflow. Sidebar navigation and member/profile lists scroll
vertically only; their horizontal overflow is clipped. Vertical scrollbars retain
their normal styling. Member buttons also account for their horizontal margins.
Username changes refresh the Auth.js session in place rather than reloading the
application. Public profile dialogs open from identity links and show existing
name/handle, live presence, the shared server in the current view and a Message
action for accepted friends that opens their conversation in the Friends
workspace without leaving voice. Member and friend entries open profiles across
their full identity area, including the avatar. Profiles offer friend requests
by public user ID through the existing authenticated Friends API, acceptance of
incoming requests, and a pending state for sent requests. Demo accounts retain
the API restriction on friendship changes. Profiles use already authorized client data; they
do not fetch private account details or introduce new public profile fields.
Both cogs use
the same SVG. The channel/conversation sidebar has a 320px minimum to reserve
space for the profile picture and media controls. Both it and All users can be
resized using their inner-edge drag handles or arrow keys; independent preferred
widths are stored locally and reset by double-clicking the relevant handle.
The member sidebar grows leftwards. Mobile retains viewport-limited widths. Call
diagnostics open beside the connection-info icon and remain within the viewport.
Device menus render through a shared portal outside footer/call stacking contexts,
aligned to the sidebar and clamped above their trigger. Pointer events within the
portal stay inside the open menu; Escape closes it and restores trigger focus.
Embedded legal documents intercept their same-origin Back to LC link before
navigation and close only the overlay, preserving the mounted app and call.
Directly opened legal pages retain their ordinary return link.
The optional `npm run test:webrtc-browser -- --workspace-controls` browser check
exercises modal focus/stacking, pointer and keyboard resizing, diagnostic placement,
mobile bounds and persistent call audio while opening and closing settings.

## Source files and validation

- [app/page.tsx](../../app/page.tsx)
- [app/workspace-shell.tsx](../../app/workspace-shell.tsx)
- [app/settings-modal.tsx](../../app/settings-modal.tsx)
- [app/help-tour.tsx](../../app/help-tour.tsx)

Relevant tests: [workspace-location.test.mjs](../../tests/workspace-location.test.mjs), [help-tour.test.mjs](../../tests/help-tour.test.mjs), [direct-webrtc.browser.mjs](../../tests/direct-webrtc.browser.mjs).

Run the affected UI tests and `npm.cmd run build`. Use `--workspace-controls` / `--workspace-layout` for focus, sizing, overlays and call continuity. Equivalent controls share components/CSS and retain the global button hover behavior.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
