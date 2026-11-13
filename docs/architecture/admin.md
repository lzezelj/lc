# Application administration

[Architecture overview](../../ARCHITECTURE.md) · Related: [Authentication](authentication.md), [Messaging](messaging.md), [Servers and presence](servers-and-presence.md), [Database](database.md), [Workspace UI](ui.md).

## Access boundary

`/admin` is a separate, dynamically rendered page. User settings opens it in a new
tab with `noopener,noreferrer`, keeping the existing workspace and call mounted.
It does not mount a voice connection or join a server. The server page checks
authentication and `server/owner.ts`; nonowners receive no dashboard data.
Every handler of `/api/admin`, `/api/admin/files`, `/api/admin/server-picture`, plus all demo-account API
handlers, independently checks that same owner guard before reading request
filters or accessing admin data. Neither membership ownership nor a stale stored
global owner role grants access.

The guard uses the authenticated account's current database email and the current,
server-only `OWNER_EMAIL`, trimmed and case-insensitive. Missing/blank configuration
fails closed. Demo accounts never qualify. Auth.js session refresh also derives
the effective global role from that email and refreshes session email, so existing
global-owner message operations and actor quota exemptions follow configuration
changes without requiring another Google sign-in. Stored account roles are not
rewritten by background session reads. Ordinary membership APIs keep their own
server-owner/member checks and do not acquire global read privileges.

## Reads and navigation

The dashboard stylesheet (`app/admin/admin.css`) uses the shared workspace UI
tokens for surfaces, typography, controls, cards, selection and focus. Buttons
inherit the global hover animation and reduced-motion behavior; confirmation
forms retain the shared settings modal. See [visual rules](ui.md#visual-rules-and-consistency).

`server/admin-read.ts` owns parameterized, explicitly selected admin queries.
Users expose ID, display name, handle, profile image, account type, creation time,
expiry and disabled state. Email addresses, OAuth links/credentials, cookies,
session tokens, invitation hashes and unrelated settings are excluded.
Presence is a snapshot from the secret-authenticated internal signaling
`/internal/admin-presence` endpoint (at most 50 supplied account IDs). It includes
the account's selected status, including Invisible; an unavailable signaling
service is shown as unavailable rather than Offline. Refresh requests a new snapshot.

Users and servers are independently searchable entry points. User server lists
include current memberships and servers with retained authored messages after a
membership ends, explicitly distinguished. User/server views list channels where
that user authored messages. User-wide and server-wide message searches support
optional channel narrowing. User DMs are a separate section, grouped by recipient,
and show messages **sent** by that user, including call-history records. Friendship
or the admin's own membership is not required for these admin-only reads.
Message rows link back to their author, server and channel and include timestamps,
reply context, attachments, deletion placeholders and edit attribution.

Search queries are limited to 200 characters and UUID filters are validated.
Typing searches automatically after the shared 500 ms debounce; explicit Search
and pagination remain immediate. See [shared search behavior](ui.md#shared-controls-and-search-behavior).
Lists return at most 50 records plus a next-page indicator, with deterministic
ordering and bounded page numbers. Search/page state is kept in the URL so Back
can restore filters. Pagination uses offsets; concurrent writes can shift a page,
so Refresh is the recovery mechanism. These queries target the existing small
deployment, with an added author/timeline message index; substring search is not
a dedicated search engine. No admin content is persisted in browser storage.

Admin file reads independently authorize the owner, then require live,
unexpired attachment metadata or the selected stored avatar. Deleted-message
attachments cannot be downloaded. Attachment downloads retain range support,
no-store/private responses, nosniff and sandbox headers. They use a separate API
instead of weakening ordinary membership/friendship download authorization.

## Mutations and audit history

All admin UI create/edit/delete operations open a confirmation dialog. Forms show
the intended changes and submit through Confirm. New admin mutations require
bounded JSON, explicit `confirmed: true`, and the shared admin mutation rate limit.

`server/admin-mutations.ts` supports text-message edits, soft/permanent message
deletion and channel creation/renaming/deletion for text, native voice and group
voice. Editing rejects deleted messages and call-history records, enforces the
existing 4,000-character/content-or-attachment rule, preserves author identity and
sets `edited_by_admin`. Ordinary later author edits reset that flag. Channel mention
state is rebuilt against the actual author; admin edits do not send a new mention
alert attributed to that author. Existing history and live updates carry the flag
and shared message headers display `(edited by admin)`.

The mutation and its `admin_audit_log` insert commit in one transaction; audit
failure rolls back the mutation. Entries store UUID actor/target/context identifiers,
action and timestamp, without previous/new message text, names or credentials.
They have no target foreign keys, so deleting a message, channel or account cannot
erase the history. The dashboard has a read-only searchable/paginated Admin log;
there is no audit-edit/delete API or automatic retention job. Existing demo
mutations and legacy owner operations deleting demo messages also write audit entries.
Ordinary users' self-service and server-owner actions are not admin-log actions.

Message changes reuse PostgreSQL's attachment/reaction/mention cleanup triggers
and reply `ON DELETE SET NULL` behavior. Post-commit notifications use the existing
channel edit/deletion endpoints; DM notifications target both actual participants
with the opposite participant's ID, never substituting the admin as sender.

Channel mutations lock the parent server before channel changes. Deletion
cascades its message history, then uses `removeChannelMedia` and `notifyServer`.
The admin reason passes through authenticated signaling to existing clients.
Only clients in the deleted active voice channel close their call and see
“This channel was deleted by an admin.” Other calls continue. The existing
permission tombstone rejects stale channel tokens and group cleanup deletes the
LiveKit room. Signaling/LiveKit notifications remain best effort after durable
commit; an unavailable media service can delay remote cleanup. There is no durable
notification outbox or automatic retry worker.

Demo management is located only in the admin dashboard. It reuses
`/api/demo-accounts` and retains creator-scoped account administration and
owned-server assignment rules, invitation expiry, revocation and extension
semantics. Invitation URLs are shown only in temporary UI state after creation
or regeneration and never enter the admin log. General account profile mutation,
allowlist editing and infrastructure administration are outside
this dashboard's scope.

Regeneration confirms server assignments in the same transaction as reactivation;
an account without assignments cannot receive a renewed invitation. This avoids
expired-account cleanup removing newly chosen memberships between separate steps.
Changing assignments during regeneration also disconnects existing connections.

## Server and user administration

Server settings also offers Remove/Enable soundboard cooldown, with confirmation
and transactional `server.soundboard` audit history. This owner-only option applies
to everyone in the selected server and defaults to enabled. Migration
`0033_soundboard_cooldown` is required; see [soundboard playback](soundboards.md).

`server/admin-entities.ts` adds server creation, name/AFK/ownership changes and
server/user deletion behind the same current-owner guard, rate limiter, bounded
JSON parser and transactional audit contract. No further migration is needed.
Server creation makes the admin the server owner and creates general text and
Lounge native-voice channels, optionally adding an AFK group channel. Name edits
retain the 1–60-character bound. AFK can be disabled, set to a group channel in
that server, or create a new group destination; disabling keeps the channel.

Ownership transfer locks old/new owner accounts in UUID order before the server,
requires a current active non-demo member, enforces the recipient's three-server
limit (current configured owner exempt), and updates creator/membership roles
atomically. The old owner remains a member. The new owner has server mute/deafen
restrictions cleared through the existing LiveKit and per-user event paths.

Server pictures reuse `ProfilePictureSettings` and `readAvatar` for cropping,
encoding and bounded PNG validation. The admin picture API authorizes every read,
upload and removal independently; writes require `X-Admin-Confirmed: true` and
an additional confirmation dialog. The picture bytes, server URL and audit entry
commit together. Members and pending invitees receive the normal picture update.
Admin preview uses the admin-only image endpoint, including for servers the
admin has not joined. Ordinary picture authorization remains unchanged.

Server deletion requires `confirmed: true` and typed `DELETE`. Its confirmation
shows that channels/history/pictures/sounds are permanently removed and that demos
losing their final server are revoked. The transaction locks member accounts
before the server, snapshots members/channels/invitees, disables/revokes those
demos, deletes the server and records all admin actions. After commit each channel
uses existing media cleanup, former members receive `access-changed` with
`server-deleted`, invitees refresh their pending invitations, and affected demos
are disconnected. The workspace clears deleted selected content and shows an admin
deletion notice; unrelated calls survive. The documented best-effort media/event
delivery limitation still applies.

User deletion also requires typed `DELETE` and an explicit message-erasure boolean.
It blocks the current/configured owner and accounts that still own servers.
The locked-account transaction removes OAuth/session links, memberships,
friendships, invitations and stored avatar bytes, then clears profile identifiers
and disables the account as `Deleted user`. The anonymous database row remains to
preserve references and incoming DMs authored by others. The default keeps sent
messages; the erase option permanently removes only that user's channel messages
and sent DMs. Audit and all data changes commit together. Post-commit account
disconnection, message-removal events, friend/member refresh and profile updates
reconcile existing clients. Deployment allowlists are unchanged, so deletion does
not prevent a still-allowlisted Google identity from registering again.

## Schema and validation

Migration `0032_admin_dashboard` adds the audit table/index, two admin-edit flags
and the channel-message author/timeline index. Apply migrations before running
the updated application; no deployment/infrastructure changes are included.

`tests/admin.test.mjs` covers current-owner policy, API denial, parameterized
bounded reads, DM identities, confirmation, edit/deletion rules, audit failure and
active-channel notices. `tests/admin.database.test.mjs` tests actual PostgreSQL
queries, atomic audit rollback, author preservation, attachment cleanup, reply
survival and channel mutation. It rolls back its fixtures and, if needed, the new
migration. Existing auth, demo, message, channel and signaling suites also apply.
The PostgreSQL admin test also covers server CRUD/AFK/ownership/pictures, final-demo
revocation, user message retention/erasure and blocked owner/owned-server deletion.
The join-sound database test uses a scoped transaction proxy and checks its fixture
UUIDs after rollback to prevent route-level transaction commits leaking test data.
Run formatter, `npm.cmd test`, the relevant PostgreSQL tests and build.
`node tests/direct-webrtc.browser.mjs --admin` runs muted desktop/mobile tests of
the actual dashboard components with fixture API/session/router data, including
confirmation/cancel, pagination, crosslinks, attachment links, admin attribution,
layout and session revocation. These do not exercise a deployed LiveKit service.
