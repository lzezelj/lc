# Database and persistence

Durable storage ownership, schema/migration entry points and the location of feature-specific persistence contracts.

Direct-message rows also identify durable conversation peers independently of
friendships. Removing a friendship leaves those rows and read/preferences state
intact; no conversation-table migration is introduced. See
[direct conversations](messaging.md#direct-conversations-and-friendship).

[Architecture overview](../../ARCHITECTURE.md) · Related: [Authentication and authorization](authentication.md), [Messaging and conversation history](messaging.md), [Servers, channels and presence](servers-and-presence.md), [Infrastructure, deployment and operations](infrastructure.md).

## PostgreSQL and Drizzle

PostgreSQL is the source of truth for durable application state. The main data
model contains:

- users and linked OAuth accounts;
- hashed demo invitations and their expiry/revocation state;
- servers and server memberships;
- text, direct-voice, and group-voice channels;
- persistent text messages, reply relationships, and deletion timestamps;
- stable public user handles, friendships, friend-only direct messages, and a
  friendship activity timestamp used to order recent conversations. Sending a
  direct message or starting a direct call updates that timestamp. Direct
  message history also stores typed call-ended entries and their duration.

Drizzle defines the schema and migrations. A one-shot migration container runs
after PostgreSQL becomes healthy and before the application starts.

Host-side logical backups, retention, interactive restore-by-date and recovery
limitations are owned by [infrastructure](infrastructure.md#database-backups-and-restore).
These dumps include database-held media; environment configuration and cluster
roles remain separate recovery prerequisites.

## Feature-owned persistence contracts

Schema and migrations are defined in [db/schema.ts](../../db/schema.ts) and
[db/migrations](../../db/migrations). Feature documents own the detailed table,
transaction, retention and notification contracts; keep those details in one place.

| Data or migration | Owning topic |
| --- | --- |
| Accounts, OAuth links, demo invitations and deletion | [Authentication](authentication.md) |
| Admin audit records and message moderation attribution | [Application administration](admin.md) |
| Messages, attachments, reactions, history and retention | [Messaging](messaging.md) |
| Read positions, mentions and notification preferences | [Notifications](notifications.md) |
| Memberships, server pictures/invitations, AFK and ordering positions | [Servers and presence](servers-and-presence.md) |
| Sound bytes, metadata, quotas and join-sound preferences | [Soundboards](soundboards.md) |
| Profile picture storage and profile-update events | [Workspace UI](ui.md#avatars-profiles-and-identity-updates) |

These are documentation ownership boundaries, not separate databases. PostgreSQL
remains shared, and cross-feature changes must preserve the documented lock order,
authorization checks and persistence-before-notification behavior.

## Source files and validation

- [db/schema.ts](../../db/schema.ts)
- [db/index.ts](../../db/index.ts)
- [db/migrations/meta/_journal.json](../../db/migrations/meta/_journal.json)

Relevant tests: [database.test.mjs](../../tests/database.test.mjs), [notifications.database.test.mjs](../../tests/notifications.database.test.mjs).

Run the relevant database tests against the local test database. Read the owning feature document before changing its tables, transactions, authorization or event delivery.
See the [test guide](../../tests/README.md) for browser prerequisites and mode details.
