# Authentication and authorization

Google identity, allowlists, demo credentials, API/media authorization, sessions and self-service account deletion.

[Architecture overview](../../ARCHITECTURE.md) · Related: [Servers, channels and presence](servers-and-presence.md), [Voice sessions and transports](voice-and-media.md), [Database and persistence](database.md).

## Google login and allowlist

The current-owner admin guard and effective session-role revalidation are described
in [Application administration](admin.md#access-boundary). Session access refreshes
email from PostgreSQL and derives global ownership from current `OWNER_EMAIL`;
the database's stored role alone does not retain global-owner access.

Google authentication succeeds only when Google reports a verified email that
matches `OWNER_EMAIL` or one of the comma-separated addresses in
`ALLOWED_EMAILS`. Both variables are deployment configuration; there is no API
or UI for changing the allowlist. The `OWNER_EMAIL` account retains the global
`owner` role. Other allowlisted accounts receive the `member` role, can create
and administer up to three servers they own, and cannot administer demo
accounts. Auth.js uses an encrypted JWT session strategy, while linked OAuth
account data is stored in PostgreSQL. Whenever the session is accessed, the
JWT callback revalidates that the user still exists and is neither disabled nor
expired. Invalid sessions return no session and Auth.js clears their session
cookie. The browser refreshes its session state at least once per minute and
whenever the window regains focus.

Google user handles are allocated after Auth.js has persisted the user, in the
initial JWT callback. Existing users with missing handles are repaired on session
validation. Demo creation assigns a handle within its creation transaction.
Allocation uses the unique handle constraint and retries collisions without
overwriting a handle assigned by a concurrent request. Stable stored handles
retain the canonical `username.1234` form; the UI displays `username (1234)` and
friend/server lookup accepts both forms, including partial bracket searches.
The current user's handle is included in the session and account settings;
Friends and server profile footers show the display name and selected status.

Login sessions use a renewable 24-hour lifetime. Successful session refreshes
issue a fresh JWT/cookie for another 24 hours, including background session polls;
this is not a hard deadline measured from the original login. The JWT callback
also checks the token's issued-at timestamp against 24 hours so legacy cookies
issued with the former 30-day lifetime cannot bypass the shorter policy. A
missing database user or disabled account invalidates authentication on its next
check. Manual database deletion does not itself notify already-open WebSocket
or LiveKit connections; the application account-management flow explicitly
disconnects those connections. Allowlist changes still apply at Google sign-in.

## Demo login

1. The owner selects a server and creates a demo account.
2. The server generates 32 random bytes and returns the token only in the
   invitation URL.
3. Only a SHA-256 hash of that token is stored in PostgreSQL.
4. The invitation expires after four hours.
5. Redemption atomically requires the invitation to be unexpired, unrevoked,
   and unused, then marks it as redeemed.
6. Revocation disables the demo user and removes its server memberships.

The owner can extend an active or pending demo account by 1–720 whole hours per
operation. An owner-authorized, rate-limited transaction locks the account and
invitation, checks current access/membership, and adds time to the existing
deadline. Account and invitation expiry update together; token hashes,
redemption/revocation state, memberships and ongoing calls are preserved.
Existing logins see the new account deadline on their next validation. Demo
account expiry remains an independent limit even while the 24-hour login cookie
renews. Expired/revoked accounts use the existing invitation/server-assignment
reactivation flow instead of extension. No database migration is required.

Expired demo accounts are also excluded from server and member queries. Their
membership rows are removed when expiration is observed during session
validation or demo-account management. Expiration and revocation preserve the
account's existing messages unless an authorized user explicitly deletes them.

This design prevents a database reader from directly using stored invitation
values as login credentials.

## API authorization

Server context menus expose deletion to the server owner and leaving to other
members. The leave API derives the account from the session, rejects owners,
and prevents demo users from leaving their final server in a user-locked
transaction. Leaving removes membership and refreshes signaling permissions;
group media membership is revoked through the existing disconnect flow.

The server never accepts a client-supplied author identity. API routes derive
the user from the authenticated session and verify the relevant server or
channel membership before reading or modifying data. Server creators receive a
server-owner membership and may administer only those servers; the global owner
retains demo-account administration.
Migration `0029_server_moderators` adds `mod` to the per-server membership enum,
without changing global account roles. Owners promote/demote existing active
non-demo members through Members settings and PATCH `/api/servers/{id}/members`.
Role changes lock users in stable order, then the server and memberships; they
recheck the current owner and never modify the owner's membership. Moderators
gain sound upload only; other administration and sound deletion stay owner-only.
They retain ordinary join-sound, leave and channel access. Owners can remove
moderators and transfer ownership to them under the existing eligibility rules.
After commit, server updates refresh member roles and trigger soundboard capability
reloads in open settings/call panels. Focus also rechecks those capabilities;
backend mutation checks remain authoritative during stale UI or in-flight uploads.
The server owner can transfer ownership to an existing active non-demo member
through Members settings, with explicit confirmation. The transfer locks both
accounts in stable order and the server, verifies the current owner's membership
and ownership record, enforces the recipient's three-server limit (global owner
exempt), and changes servers.createdBy plus both membership roles in one
transaction. The former owner stays as a member. Global account roles are not
changed, and calls are not disconnected. Server updates refresh role displays
for connected clients. Concurrent member removal cannot delete a promoted owner.

Users may inspect and delete messages authored by their own account. The owner
may do the same only for demo accounts that the owner created. Ordinary message
deletion is a soft deletion: the content is erased while the row remains so
replies can display a stable `Deleted message` placeholder. This is checked by
the API; it is not only a UI restriction. The confirmation UI also offers an
explicit, default-off permanent deletion. Permanent deletion removes the row;
the reply foreign key uses `ON DELETE SET NULL`, so replies survive without a
reference to content that no longer exists.
Own deleted-message placeholders expose a confirmed permanent removal action in
channel context menus and direct-message rows, using those same authorized APIs.

The owner can replace a demo account's server memberships, regenerate its
short-lived invitation, revoke it, or delete it. Membership replacement must
retain at least one server. Account deletion either permanently deletes the
account's messages and user row, or anonymizes the disabled user as
`Deleted user` so retained messages remain attributable without retaining the
demo identity.

## Signaling authorization

The browser requests a signaling token from Next.js. Next.js reads the user's
current channel memberships and signs this identity and channel list with
HMAC-SHA256 using `AUTH_SECRET`. The token expires after 60 seconds and is
verified with a timing-safe signature comparison by the WebSocket service.

The short lifetime limits token reuse. Administrative membership changes call
the internal disconnect endpoint, forcing affected sockets to reconnect before
receiving a refreshed permission list.
The browser caches a signaling token for at most 45 seconds so its independent
presence, text, and direct-call sockets do not each consume a token issuance.
Access and friendship changes invalidate that cache immediately. Server and
channel navigation updates subscriptions on the persistent presence socket
instead of reconnecting it.

## LiveKit authorization

Next.js checks that the authenticated user belongs to the channel's server and
that the channel is a group voice channel. It then signs a LiveKit token with a
30-second initial lifetime and a grant allowing entry only to that channel's room. The
LiveKit API secret is never sent to the browser.

## Self-service account deletion

The [admin user-deletion flow](admin.md#server-and-user-administration) applies
the same anonymization and optional sent-message erasure policy to other accounts,
with configured-owner protection, owned-server blocking and an atomic audit entry.

Account deletion is a confirmed self-service operation requiring the literal
DELETE and an explicit message-retention choice. A transaction locks the account,
rejects accounts that still own servers, removes OAuth links, sessions,
friendships and memberships, and clears profile identifiers while disabling the
remaining anonymous user row. That row retains incoming messages and other
users' foreign-key references. The optional erase choice permanently removes
only messages sent/authored by this account, including DMs; other senders'
messages survive. After commit, signaling and LiveKit connections are revoked,
affected peers receive deletion/presence updates, and the client signs out.
Existing JWTs fail the normal disabled-account check. This does not edit the
deployment allowlist: a still-allowlisted person can later register a new account.

## Source files and validation

- [auth.ts](../../auth.ts)
- [auth-account.mjs](../../auth-account.mjs)
- [server/signaling-auth.mjs](../../server/signaling-auth.mjs)
- [app/api/demo-accounts/route.ts](../../app/api/demo-accounts/route.ts)

Relevant tests: [auth-account.test.mjs](../../tests/auth-account.test.mjs), [demo-extension.test.mjs](../../tests/demo-extension.test.mjs), [account-privacy.test.mjs](../../tests/account-privacy.test.mjs).

Run the relevant authentication/account tests and `npm.cmd run build`. Permission changes also need the affected API and signaling tests.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
