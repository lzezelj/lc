import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "dotenv/config";
import pg from "pg";

const { Client } = pg;

test("custom sound migration enforces storage bounds and cascades without touching application data", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const schema = `lc_sound_test_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query("CREATE TABLE servers (id uuid PRIMARY KEY)");
    const migration = await readFile(
      new URL("../db/migrations/0011_server_sounds.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    const server = randomUUID();
    await client.query("INSERT INTO servers (id) VALUES ($1)", [server]);
    const audio = Buffer.alloc(44);
    const insert = await client.query(
      "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, 'Clip', $2, 600) RETURNING id, audio",
      [server, audio],
    );
    assert.deepEqual(insert.rows[0].audio, audio);
    await client.query(
      await readFile(
        new URL("../db/migrations/0012_sound_limits.sql", import.meta.url),
        "utf8",
      ),
    );
    await client.query(
      "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, 'Ten seconds', $2, 10000)",
      [server, Buffer.alloc(1920044)],
    );
    assert.equal(
      (
        await client.query(
          "SELECT duration_ms FROM server_sounds WHERE id = $1",
          [insert.rows[0].id],
        )
      ).rows[0].duration_ms,
      600,
      "The limit migration must preserve existing clips",
    );
    for (const [name, bytes, duration] of [
      [" ", audio, 600],
      ["Clip", Buffer.alloc(2097153), 600],
      ["Clip", audio, 10001],
    ]) {
      await client.query("SAVEPOINT invalid_sound");
      await assert.rejects(
        client.query(
          "INSERT INTO server_sounds (server_id, name, audio, duration_ms) VALUES ($1, $2, $3, $4)",
          [server, name, bytes, duration],
        ),
        (error) => error.code === "23514",
      );
      await client.query("ROLLBACK TO SAVEPOINT invalid_sound");
    }
    await client.query("DELETE FROM servers WHERE id = $1", [server]);
    assert.equal(
      (await client.query("SELECT count(*)::int AS count FROM server_sounds"))
        .rows[0].count,
      0,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});

test("deleting a server cascades to its channels, memberships, and messages", async () => {
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
    const channels = await client.query(
      "SELECT count(*)::int AS count FROM channels WHERE server_id = $1",
      [serverId],
    );

    assert.equal(memberships.rows[0].count, 0);
    assert.equal(messages.rows[0].count, 0);
    assert.equal(channels.rows[0].count, 0);
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
    await client.query("BEGIN");
    const userId = randomUUID();
    const serverId = randomUUID();
    const channelId = randomUUID();
    await client.query(
      "INSERT INTO users (id, role, name, email) VALUES ($1, 'owner', 'Owner', $2)",
      [userId, `owner-${userId}@example.test`],
    );
    await client.query(
      "INSERT INTO servers (id, name, created_by) VALUES ($1, 'Constraints', $2)",
      [serverId, userId],
    );
    await client.query(
      "INSERT INTO channels (id, server_id, name, type) VALUES ($1, $2, 'general', 'text')",
      [channelId, serverId],
    );
    for (const [channel, author] of [
      [randomUUID(), userId],
      [channelId, randomUUID()],
    ]) {
      await client.query("SAVEPOINT invalid_message");
      await assert.rejects(
        client.query(
          "INSERT INTO messages (channel_id, author_id, content) VALUES ($1, $2, 'Invalid')",
          [channel, author],
        ),
        (error) => error.code === "23503",
      );
      await client.query("ROLLBACK TO SAVEPOINT invalid_message");
      await client.query("RELEASE SAVEPOINT invalid_message");
    }
  } finally {
    await client.query("ROLLBACK");
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
