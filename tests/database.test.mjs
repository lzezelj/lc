import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

test("database preserves server, channel, membership, and message relationships", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const ownerId = randomUUID();
    const demoId = randomUUID();
    const serverId = randomUUID();
    const channelId = randomUUID();

    await client.query(
      `INSERT INTO users (id, role, name, email)
       VALUES ($1, 'owner', 'Owner', $2), ($3, 'demo', 'Guest', NULL)`,
      [ownerId, `owner-${ownerId}@example.test`, demoId],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'Interview', $2)",
      [serverId, ownerId],
    );
    await client.query(
      `INSERT INTO server_members (server_id, user_id, role)
       VALUES ($1, $2, 'owner'), ($1, $3, 'member')`,
      [serverId, ownerId, demoId],
    );
    await client.query(
      `INSERT INTO channels (id, server_id, name, type)
       VALUES ($1, $2, 'general', 'text')`,
      [channelId, serverId],
    );
    await client.query(
      "INSERT INTO messages (channel_id, author_id, content) VALUES ($1, $2, 'Hello')",
      [channelId, demoId],
    );

    await client.query("DELETE FROM servers WHERE id = $1", [serverId]);
    const memberships = await client.query(
      "SELECT count(*)::int AS count FROM server_members WHERE server_id = $1",
      [serverId],
    );
    const messages = await client.query(
      "SELECT count(*)::int AS count FROM messages WHERE channel_id = $1",
      [channelId],
    );

    assert.equal(memberships.rows[0].count, 0);
    assert.equal(messages.rows[0].count, 0);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("messages cannot reference users or channels that do not exist", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await assert.rejects(
      client.query(
        "INSERT INTO messages (channel_id, author_id, content) VALUES ($1, $2, 'Invalid')",
        [randomUUID(), randomUUID()],
      ),
      (error) => error.code === "23503",
    );
  } finally {
    await client.end();
  }
});

test("channels distinguish direct and SFU-backed group calls", async () => {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");
    const ownerId = randomUUID();
    const serverId = randomUUID();
    await client.query(
      "INSERT INTO users (id, role, name, email) VALUES ($1, 'owner', 'Owner', $2)",
      [ownerId, `owner-${ownerId}@example.test`],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'Calls', $2)",
      [serverId, ownerId],
    );
    await client.query(
      `INSERT INTO channels (server_id, name, type)
       VALUES ($1, 'Pair', 'voice_direct'), ($1, 'Team', 'voice_group')`,
      [serverId],
    );
    const result = await client.query(
      "SELECT type FROM channels WHERE server_id = $1 ORDER BY type",
      [serverId],
    );

    assert.deepEqual(
      result.rows.map((row) => row.type),
      ["voice_direct", "voice_group"],
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
