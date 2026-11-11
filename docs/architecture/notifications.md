# Notifications and activity

Typing, unread state, read positions, mentions, notification preferences/sounds and authorized workspace activity subscriptions.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Messaging and conversation history](messaging.md), [Servers, channels and presence](servers-and-presence.md), [Authentication and authorization](authentication.md), [Workspace UI and navigation](ui.md).

## Server and channel activity

Typing indicators use transient authenticated signaling, not PostgreSQL. The
composer sends activity at most once per two seconds while input changes and
sends stop on blur, submission, empty input or context cleanup. It sends no draft
text. The server derives identity/name from signed claims, checks channel access
or accepted-friend claims and limits active updates. One temporary context per
socket expires after six seconds; a one-second sweep publishes changes. Multiple
tabs deduplicate to one typist, and closing one preserves another tab's activity.
Channel snapshots reach authorized subscribed clients; DM snapshots reach the
two accounts with reciprocal friend claims. The client filters the active
conversation and own identity, with a seven-second expiry fallback and offline
cleanup. These events do not refresh messages, unread state or media. Typing
shares the existing signaling permission snapshot/freshness boundary and its
single-process limitation; scaling would require shared transient coordination.

Unread text activity appears as a dot on the server icon and beside its channel
name, in both Friends and server workspaces. The account's persistent signaling
socket subscribes to workspace activity using only channel IDs in its signed
token. Message events contain channel/message IDs, author ID and creation time;
they do not duplicate the message body or replace the selected channel's text
socket. Own messages and duplicate/older events do not create unread markers.

GET `/api/workspace-activity` checks the session and joins current server
memberships to channels, returning channel/server mappings and the latest live
message from another author per channel. It does not return message contents.
Startup, reconnect, focus, deletions and server changes refresh this PostgreSQL
snapshot. Generation guards retain live events arriving during a fetch and reject
responses from obsolete requests/accounts. Server-update events refresh signaling
credentials so new channels join the authorized workspace subscription.

Migration `0015_mentions_notifications` adds account-scoped PostgreSQL read
positions (`channel_reads`, `direct_reads`), per-server and per-friend notification
preferences, mention metadata on messages, and a unique message/recipient mention
table. Existing history is baselined as read at rollout. New memberships/channels
start at the later of membership and channel creation; new friend read positions
start at acceptance when their read position is first initialized. IDs and full PostgreSQL timestamps form monotonic read
cursors; an older acknowledgement cannot move a cursor backward. These are personal
read positions, not sender-visible delivery/read receipts.

GET `/api/notifications` returns only the authenticated account's accessible text
channels, accepted direct conversations and preferences. It reports a generic
unread flag per channel, unread mention counts per channel, unread DM counts and
the first unread message ID. Channel/server marks use the same location: ordinary
activity is a plain dot, while a numbered mention badge overlays that dot. Server
counts sum their channels. Mention counts are per message/recipient, so repeating
the same tag cannot inflate them. Muting changes alerts, not stored unread state.
The existing latest-message workspace tracker remains a browser-local fallback
for generic server activity while the durable inbox is unavailable; durable counts
take precedence once loaded. Voice presence still uses its existing snapshot.

POST `/api/notifications/read` checks current membership or the exact accepted DM
pair and acknowledges through a real message in that conversation. SQL retains
timestamp precision and updates the mention acknowledgement time independently,
so a new mention added by an edit can notify even when the original message was
read. The client acknowledges only while the current, loaded live conversation
is visible in a foreground tab and scrolled to its latest messages. Search context,
older scrolling, legal/profile/settings overlays and background tabs do not clear
activity. A synchronous layout visibility guard avoids acknowledging while the
history is positioning at its first unread message. New messages are separated
by a retained divider for the current visit; unread boundaries outside the loaded
pages have a notice instead of forcing all history to load. Reaching latest treats
the conversation through that point as read; individual rows are not tracked.
Read changes and preference changes emit an authenticated per-user refresh event
to other tabs/devices. Focus/reconnect reloads recover missed events.

User settings → Notifications separates searchable Servers and People tabs,
with independent server message/mention and DM message/call controls. Searches
filter names locally and retain each tab's query while switching categories.
Right-clicking a server opens Mute notifications; right-clicking an accepted
friend in the conversation list, Friends list or member list exposes the same
saved preferences. Both entry points reuse the same notification controls and
authenticated preferences API. Server mentions count on their server/channel
badges, while the LC badge and browser title count only direct/friend activity.
Each control supports enable, disable indefinitely,
or mute for 1, 8 or 24 hours. Preferences are backend-authorized and persisted per
account; expiry refreshes the client automatically. Do not disturb remains the
global override that hides alerts without discarding counts. Silenced DM
calls retain an inline Answer action in the matching conversation while suppressing
ringing and the global popup. No OS notification permission, push service or
production infrastructure is introduced. Exact count queries are appropriate for
the private project; large histories/membership fan-out would need profiling and
potential aggregation before scaling.

Incoming friend requests/acceptances, server invitations/acceptances, direct
messages, server messages/mentions and live kick notices can play a local
synthesized notification cue. New social events carry explicit notification
metadata so inbox refresh, decline, cancellation and reconnect snapshots stay
silent. Message IDs deduplicate workspace/mention delivery. DND, deafen and the
applicable persisted server/person notification mute suppress cues; message/mention
preferences are checked separately. Cues use main output volume and a 350 ms
browser-storage cooldown coalesces bursts and multiple tabs. They never enter
published call tracks. Browser autoplay restrictions still require an initial
user interaction to unlock local audio.

Typing `@` in a server composer lists other active server members, filtered by
display name or unique handle. Mouse, Arrow keys, Enter and Tab select a handle;
Escape dismisses completion. Full display names can also be typed directly;
ambiguous duplicate names require a unique handle. The backend resolves only
current, active server members from the text and excludes the author, unknown
names, partial names and email addresses. Clients cannot supply authoritative
recipient IDs. Message text, mention offsets and unique recipients commit together,
including attachment sends. New mentions emit per-user events after persistence;
unchanged edit recipients do not receive duplicate notifications, removed tags
remove their records, and newly added edit recipients are notified. Migration
`0016_mention_deletion_cleanup` clears mention metadata/records on soft deletion,
including bulk/account paths, and permanent deletion cascades mention records.
Tags render as profile shortcuts; messages mentioning the viewer visually
mark their row.

The workspace subscription also receives initial and live direct/group voice
presence for every authorized server channel, independently of navigation.
It cannot subscribe to arbitrary channels or friend-call rooms. Occupied servers
show a speaker badge with a live participant count on their icon; hover or
keyboard focus lists participant names below the server name. Pointer clicks
do not pin the tooltip open after the pointer leaves. Users in multiple
sessions/channels are deduplicated by user ID in both the count and tooltip,
while different users with the same display name remain separate.
Snapshots clear stale occupants on signaling reconnect. Existing administrative
socket revocation applies to these subscriptions; media owners and calls are
unaffected by notification/navigation updates.

## Source files and validation

- [app/use-notification-inbox.ts](../../app/use-notification-inbox.ts)
- [app/notification-sounds.ts](../../app/notification-sounds.ts)
- [server/notification-inbox.ts](../../server/notification-inbox.ts)
- [app/api/workspace-activity/route.ts](../../app/api/workspace-activity/route.ts)

Relevant tests: [notifications.test.mjs](../../tests/notifications.test.mjs), [notifications.database.test.mjs](../../tests/notifications.database.test.mjs), [workspace-activity.test.mjs](../../tests/workspace-activity.test.mjs), [call-sounds.test.mjs](../../tests/call-sounds.test.mjs).

Run the affected notification/activity tests and database tests when changing persistence. Use the browser `--notifications` mode for rendered inbox and badge behavior.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
