import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "dotenv/config";
import pg from "pg";

test("soundboard cooldown migration defaults on and permits independent server policies", async () => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    // A temporary table shadows the real servers table; all changes roll back.
    await client.query(
      "CREATE TEMP TABLE servers (id integer PRIMARY KEY) ON COMMIT DROP",
    );
    await client.query("INSERT INTO servers VALUES (1), (2)");
    await client.query(
      await readFile(
        new URL(
          "../db/migrations/0033_soundboard_cooldown.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT soundboard_cooldown_enabled FROM servers ORDER BY id",
        )
      ).rows.map((row) => row.soundboard_cooldown_enabled),
      [true, true],
    );
    await client.query(
      "UPDATE servers SET soundboard_cooldown_enabled=false WHERE id=1",
    );
    assert.deepEqual(
      (
        await client.query(
          "SELECT soundboard_cooldown_enabled FROM servers ORDER BY id",
        )
      ).rows.map((row) => row.soundboard_cooldown_enabled),
      [false, true],
    );
    await client.query(
      "UPDATE servers SET soundboard_cooldown_enabled=true WHERE id=1",
    );
    await client.query("INSERT INTO servers(id) VALUES (3)");
    assert.ok(
      (
        await client.query("SELECT soundboard_cooldown_enabled FROM servers")
      ).rows.every((row) => row.soundboard_cooldown_enabled),
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
