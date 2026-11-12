# Servers, channels and presence

Server pictures/invitations, membership lifecycle, online/Away/AFK state, channel management and saved drag ordering.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Authentication and authorization](authentication.md), [Notifications and activity](notifications.md), [Voice sessions and transports](voice-and-media.md), [Workspace UI and navigation](ui.md), [Database and persistence](database.md).

## Server pictures and pending invitations

Server settings → Overview lets the server owner upload, crop or remove a server
picture using the shared picture editor. The server rail and pending server
invitations show that picture, falling back to the server initial. Pending friend
requests and server invitations are grouped into Incoming and Outgoing sections.
Successful recipient acceptance sends a named confirmation toast to the inviter
through the existing post-commit invitation event, without notifying unrelated
members with the inviter's confirmation text. Pending invitation avatars use a
fixed-size server picture, preserving the image/placeholder overlay.
Leaving a server requires confirmation before the existing membership-removal API
is called; cancellation leaves membership and active calls intact.

Migration `0025_server_pictures` adds `servers.image` and one bounded bytea row
per server in `server_pictures`, with server-delete cleanup. The authenticated
`/api/servers/{serverId}/picture` route accepts owner-only PUT/DELETE operations,
rechecking ownership under a server-row lock. It reuses the profile PNG validator
and streamed 512 KiB limit; client crops produce 256px PNGs. The same header-only
validation limitation documented for profile images applies. GET authorizes
current membership or a pending invitation issued by the current owner, allowing
recipients to preview the picture without gaining channel access. Responses are
private/no-store, PNG-only and nosniff. Lists carry versioned URLs, not image bytes.
Targeted `server-picture-updated` events update members and invitation recipients
without clearing history, refreshing signaling authorization or restarting calls;
invitation focus refreshes and server-list reload/reconnects recover missed updates.

On reload, the authorized server-list response starts shared in-memory picture-cache
downloads before saved conversation/channel restoration finishes. Rendering never
waits for image requests. Server pictures retain their initials in a fixed-size icon until
the image loads and decodes, then fade in with reduced-motion support. Failed
loads keep initials; obsolete decodes cannot reveal a replaced image. Preloads
use the same account-scoped picture resources as rendered avatars and keep the
existing private/no-store authorization checks; no persistent image cache is
introduced. See [picture cache lifetime and bounds](ui.md#cached-navigation-and-loading).

## Online status, automatic Away and AFK

Online state is derived from authenticated WebSocket connections rather than a
database flag. The signed token includes current server IDs, and the signaling
service accepts a presence subscription only for one of those servers. Closing
the last socket for a user removes that user from the server's online set. The
browser keeps this website-level connection open even when the user has no
server or has not joined a voice channel, so online does not mean “in a call.”

Opening the website-level socket broadcasts presence to every server in its
token, so a user remains online while viewing Friends or a different server.
The profile footer shows a selectable Online, Away, Do not disturb, or Invisible
status instead of the user's handle. Status changes are authenticated self-only
signaling messages, shared across that user's connected sockets. Server-scoped
online broadcasts include visible status values; Invisible is omitted from the
online list even when the account has multiple sockets. Voice membership remains
visible while in a call. Do not disturb suppresses server/channel unread dots,
DM/Friends badges, unread browser-title counts, incoming ringtones and global
call popups. Unread state and incoming invitations are retained: a pending call
shows a quiet inline Answer/Decline banner only inside that caller's DM, including
while in Do not disturb. Outside DND that same inline banner replaces the popup
when the matching DM is open. Invitations still expire after 20 seconds; changing
status affects ringing/presentation without restarting the expiry.
Away can be selected manually or set automatically after ten minutes without
keyboard, pointer, touch, wheel or microphone speech activity. Activity in any
same-browser tab resets the shared account activity timestamp. Speech is checked
throughout an active call, separately from soundboard playback. Automatic Away
carries a separate signaling flag, synchronized across account sockets; activity
restores only automatic Away to Online. Manual Away, DND and Invisible remain set.
Automatic Away is not persisted as a manual preference on reconnect.
The signaling service retains both the selected status and automatic-Away marker
until the account's last socket closes. Closing a text/call socket during an AFK
move or reconnect must not clear that marker while the workspace or another tab
remains connected; otherwise a refreshed status snapshot would turn automatic
Away into manual Away and block activity-based restoration.

Migration `0030_server_afk` adds an optional server AFK channel reference, cleared
when the channel is deleted. Owners may create an AFK group voice channel during
server creation, or create/select/disable one in Server settings > Channels.
After fifteen minutes without the same activity, a connected browser requests a
self-move through the existing voice handoff flow. The API validates current
membership, source/destination server, and the configured AFK destination; ordinary
members cannot move another account or self-move elsewhere through this exception.
The signaling service checks the active source and performs the existing session
handoff. Returning activity restores automatic status but does not move users out
of AFK. Browser timers can be delayed when a tab or device is suspended; AFK is a
cooperative browser feature, not a server-side inactivity enforcement mechanism.

## Status persistence and authorized presence snapshots

The browser saves the preference locally and supplies it on reconnect, so an
invisible account is not briefly announced online. In-memory server status lasts
until the final socket closes; no database migration or authorization change is
required. Device menus use labeled always-visible selectors.
Clients subscribe once to a user-presence snapshot covering their authenticated
friends and shared-server members, independent of the server currently viewed.
Connect/disconnect and manual status changes refresh these snapshots for every
subscriber, updating Friends, conversations, profiles and member lists together.
Unrelated accounts are excluded and Invisible is represented as offline. The
legacy single-server presence subscription remains available to older clients.
Input and output menus share the same compact labeled device selector.

## Server invitations

Server settings member management reuses the owner-authorized membership DELETE
API for confirmed kicks. Promote groups moderator assignment and confirmed owner
transfer in one selector; existing moderators retain demotion. Channel settings
separate Text/Voice reorder groups behind category tabs and make the row surface
draggable, preserving keyboard reordering and excluding nested action controls.
Creation appears first, followed by the channel list and AFK configuration.
Members and All users share owner-first, then alphabetical sorting; All users
retains per-user status in one list. These are presentation changes to existing APIs.

Server owners have an Invite to server shortcut between these buttons, opening
Invite friends settings. Invite friends lists accepted friends alphabetically
with local search; Invite people follows it and requires at least three search
characters before showing up to 20 matching active non-demo accounts not already
in the server. Both actions require server ownership in the backend. The default
membership POST mode retains the accepted-friend requirement; explicit people
mode permits active non-friends. Demo assignments remain in demo management.
Friend discovery and Invite people wait for 500 ms without typing before searching
the API, retaining the three-character minimum. Changing the query cancels pending
work and ignores obsolete responses; submitting friend search runs immediately.
Local member/friend-list filtering stays immediate because it makes no API
requests; see [shared search behavior](ui.md#shared-controls-and-search-behavior).
These actions create account-bound pending invitations, not memberships or public
invite links. Migration `0024_server_invitations` stores one pending row per
server/recipient, with indexed inbox/outbox lookups and cascading server/account
cleanup. Existing memberships remain unchanged. Invite settings mark pending
recipients; Friends → Pending invites shows server requests alongside friend
requests, with recipient-only Accept/Decline and sender-only Cancel actions.
Incoming server requests contribute to the pending-tab and LC request badges.

`GET/PATCH /api/server-invitations` derive the actor from the session. Acceptance
locks accounts in ID order, the server, and the invitation; revalidates active
accounts/current ownership; inserts membership idempotently and consumes the
request atomically. Pending invites grant no channel, message or media access.
Decline/cancel only remove the request. Ownership changes invalidate older-owner
invitations; a current owner can reissue them. Demo assignment keeps its existing
server-at-creation flow. Creation and actions are rate limited.

After commit, targeted `server-invitations-changed` events refresh pending lists;
acceptance also refreshes member metadata and the recipient's server list. The
recipient refreshes signaling authorization without navigating or leaving calls.
Sending, declining and cancelling do not reset access or reload message histories.
The account-scoped hook retains loaded rows during refresh, rejects obsolete
responses/actions on account change, deduplicates acceptance events, and reloads
on focus/reconnection. Reconnecting also revalidates the server list to recover
acceptance on another device while offline. No existing members are converted
back into invitations.

## Channel management and personal server ordering

The Channels section supports inline renaming, confirmed deletion, creation and
drag-and-drop ordering. Channel headings in the sidebar and handles in Channels
settings allow owners to drag within Text or Voice. Server icons can be dragged
to change personal order. Separate arrow and context-menu movement controls are
not provided. Servers use their icon as the drag surface without grips; channel
grips sit inside the row and appear on hover/focus (always available on touch).
Both surfaces support mouse, pen, touch and keyboard (Space to pick up/drop,
arrows to choose position, Escape to cancel; Enter still opens a server).
Touch scrolling remains available outside drag surfaces. The dragged row follows
the pointer while neighbors slide aside; layout animations settle committed or
canceled moves without replacing rows or media. Reduced-motion preferences
disable transitions. Drop previews remain until React commits the saved order;
successful drops animate only the lifted row's landing, rather than replaying
neighbors' earlier positions. Settlement batches transform removal and final
measurements and preserves scroll positions. Background list refreshes do not
replay animations from stale viewport
coordinates. Focus restoration uses preventScroll. Drag offsets stay within the
original section bounds, edge scrolling uses the original scroll range, and
temporarily hidden server tooltips are removed from layout so transformed rows
cannot grow scrollable overflow.
Insertion markers and edge scrolling guide
drops. Vertical drops above/below the list or its scroll viewport insert at the
start/end of the source Text/Voice section (or personal server list), including
off-screen items. Horizontal departures, permission/scope changes and remote
reordering cancel the gesture. Following clicks are suppressed so
dropping does not select a chat or join voice. Existing rows and voice
participants remain mounted.
Migration `0031_list_order` adds nullable integer positions to channels and
server memberships. Existing channels receive deterministic positions within
Text and Voice sections (direct/group voice share one section), using creation
timestamp and ID as tie-breakers. Existing memberships are ranked per account by
join timestamp and server ID. New rows retain null positions and sort last, so
all channel and membership creation paths append automatically; no insert
triggers or client-only ordering are required.

POST `/api/servers/{serverId}/channels/order` verifies the owner inside a
transaction, locks the server and channel rows, places the source before/after
a validated destination only within
the selected section and normalizes that section's positions. Moderators and
ordinary members cannot change the shared channel order. Channel deletion uses
the same parent-first lock order and rechecks ownership before deleting, avoiding
lock inversions with ordering and AFK channel removal.

Every user can reorder servers by dragging. POST `/api/servers/order`
derives identity from the session, serializes that account's ordering with a
non-key user row lock, validates membership and updates only that user's
membership positions. Other members' server order is unaffected. The non-key
lock allows foreign-key checks when memberships are concurrently added.
Both move APIs accept source ID, targetId and placement (before/after), validate
access to both IDs, enforce a per-account 60/minute limit, and treat self-drops
as no-ops. Each drop is one atomic transaction, regardless of distance. Only
ordering data is changed. The pure placement helper lives in `lib/list-order.ts`
and is shared by the route bundles and drag preview. Channel move failures return
JSON, and clients handle empty/non-JSON error responses with a readable retry
message instead of surfacing a JSON parser exception.

After commit, channel moves emit targeted `channel-order-updated` events to
server members; personal moves emit `server-order-updated` only to that account's
tabs/devices. Clients reload authoritative ordered lists, ignore obsolete
responses, update cached channel snapshots and retain selected chats and active
voice sessions. Focus/reconnect recovers missed ordering events. Access changes
invalidate pending order refreshes. The active text subscription depends on
selected channel identity/type rather than the metadata array, so an order-only
refresh does not recreate that subscription. No conversation-cache reset or global
signaling-token invalidation is needed for a move.

Deletion verifies server ownership, scopes the SQL delete to that server,
and cascades channel messages. An authenticated internal channel-deleted event
revokes channel permissions on existing signaling sockets, clears presence and
closes direct peers in that channel; group deletion also removes its LiveKit room.

The separately authorized [admin dashboard](admin.md) can manage channels across
servers. Its deletion path uses this same cleanup with an admin reason and a
specific notice for affected active-call participants. Ordinary server-owner
deletion keeps its existing behavior.
Its server administration also supports creation, pictures, AFK selection and
eligible ownership transfer. Admin server deletion revokes demos losing their
final assignment and publishes a `server-deleted` access-refresh reason after
commit; see the owning [admin contract](admin.md#server-and-user-administration).
Ordinary owner deletion now shares `server/delete-server.ts` with the admin path.
It rechecks `created_by` under the server lock, captures members/channels/invitees,
disables demos losing their last membership, and deletes transactionally. After
commit it invalidates channel permissions, closes native rooms, deletes group
media rooms and refreshes affected accounts/invitations. Unrelated voice rooms
remain authorized. Ordinary deletion does not write an administrative audit entry.

## Membership revocation and moderation

Kicking a server member, changing demo-server assignments, revoking an account,
or deleting an account follows one control path:

1. Next.js verifies that the actor owns the relevant server or demo account.
2. PostgreSQL membership or account state is changed.
3. Next.js calls the signaling service's authenticated internal disconnect
   endpoint for that user.
4. The signaling service sends `access-changed` and closes matching sockets
   with code `4003`. The browser refreshes its session, server/navigation, and
   friendship state in place, and a new connection revalidates current permissions
   with the application, even when reusing an old signed token. This avoids a full-page reload loop while still letting
   an already-open no-server page discover when access is added.
5. Next.js enumerates LiveKit participants in affected group rooms and removes
   every participant identity prefixed by the user's ID.

This makes removal immediate for text signaling, direct WebRTC, presence, and
group media rather than waiting for the browser to refresh.
Server-member kicks additionally include the server ID/name and a `server-kicked`
reason in the authenticated `access-changed` event before sockets close. The
browser shows a specific kick notice, leaves revoked server content, invalidates
in-flight history and suppresses obsolete protected-fetch errors. Generic access
changes retain their previous meaning and are never labelled as kicks.

## Source files and validation

- [app/api/servers/route.ts](../../app/api/servers/route.ts)
- [app/api/server-invitations/route.ts](../../app/api/server-invitations/route.ts)
- [app/use-idle-presence.ts](../../app/use-idle-presence.ts)
- [app/drag-reorder.tsx](../../app/drag-reorder.tsx)

Relevant tests: [server-invites.test.mjs](../../tests/server-invites.test.mjs), [server-ownership.test.mjs](../../tests/server-ownership.test.mjs), [channel-management.test.mjs](../../tests/channel-management.test.mjs), [workspace-presence.test.mjs](../../tests/workspace-presence.test.mjs).

Run the affected server/channel/presence tests. Ordering changes also need `--list-order`, relevant database tests and, after building, `node --test tests/list-order.http.mjs` for the bundled HTTP route.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
