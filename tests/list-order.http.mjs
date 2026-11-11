import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import "dotenv/config";
import pg from "pg";
import { encode } from "next-auth/jwt";

// Run after npm run build. Exercise Next's bundled helper exports, auth and SQL
// through real HTTP; the VM route fixtures cannot catch stale module boundaries.
test(
  "built channel ordering route returns JSON and persists owner moves",
  { timeout: 60_000 },
  async () => {
    const require = createRequire(import.meta.url);
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    const owner = randomUUID(),
      member = randomUUID(),
      server = randomUUID();
    const ids = Array.from({ length: 4 }, () => randomUUID());
    const origin = "http://127.0.0.1:3197";
    let child;
    try {
      await client.query(
        "INSERT INTO users(id,name,handle) VALUES($1,'Ordering HTTP owner',$3),($2,'Ordering HTTP member',$4)",
        [owner, member, `ordering-${owner}`, `ordering-${member}`],
      );
      await client.query(
        "INSERT INTO servers(id,name,created_by) VALUES($1,'Ordering HTTP fixture',$2)",
        [server, owner],
      );
      await client.query(
        "INSERT INTO server_members(user_id,server_id,role) VALUES($1,$3,'owner'),($2,$3,'member')",
        [owner, member, server],
      );
      for (const [position, id] of ids.entries())
        await client.query(
          "INSERT INTO channels(id,server_id,name,type,position) VALUES($1,$2,$3,$4,$5)",
          [
            id,
            server,
            `Channel ${position}`,
            position === 3 ? "voice_group" : "text",
            position,
          ],
        );
      child = spawn(
        process.execPath,
        [
          require.resolve("next/dist/bin/next"),
          "start",
          "--hostname",
          "127.0.0.1",
          "--port",
          "3197",
        ],
        {
          windowsHide: true,
          stdio: "ignore",
          env: {
            ...process.env,
            AUTH_URL: origin,
            NEXTAUTH_URL: origin,
            AUTH_TRUST_HOST: "true",
          },
        },
      );
      let spawnError;
      child.on("error", (error) => {
        spawnError = error;
      });
      const deadline = Date.now() + 20_000;
      while (true) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null)
          throw new Error("HTTP fixture server could not start");
        try {
          if ((await fetch(`${origin}/api/auth/session`)).ok) break;
        } catch {}
        if (Date.now() > deadline)
          throw new Error("HTTP fixture server did not become ready");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const cookie = async (userId) => {
        const name = "authjs.session-token";
        const token = await encode({
          secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
          salt: name,
          token: { userId, sub: userId },
          maxAge: 120,
        });
        return `${name}=${token}`;
      };
      const post = async (actor, channelId, targetId, placement = "before") =>
        fetch(`${origin}/api/servers/${server}/channels/order`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: await cookie(actor),
          },
          body: JSON.stringify({ channelId, targetId, placement }),
        });
      let response = await post(owner, ids[2], ids[0]);
      assert.equal(
        response.status,
        200,
        "Bundled channel route must accept owner drops",
      );
      assert.deepEqual((await response.json()).ids, [ids[2], ids[0], ids[1]]);
      response = await fetch(`${origin}/api/servers/${server}/channels`, {
        headers: { Cookie: await cookie(member) },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(
        (await response.json())
          .filter((row) => row.type === "text")
          .map((row) => row.id),
        [ids[2], ids[0], ids[1]],
      );
      response = await post(member, ids[0], ids[1]);
      assert.equal(response.status, 403);
      assert.match((await response.json()).error, /owner/);
      response = await post(owner, ids[0], ids[3]);
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /section/);
    } finally {
      if (child?.pid && child.exitCode === null) {
        const stopped = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await stopped;
      }
      await client.query("DELETE FROM servers WHERE id=$1", [server]);
      await client.query("DELETE FROM users WHERE id IN ($1,$2)", [
        owner,
        member,
      ]);
      await client.end();
    }
  },
);
