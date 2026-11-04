import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const ids = Array.from(
  { length: 6 },
  (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);
const [actor, userId, serverId, sourceId, destinationId, otherServer] = ids;
const route = await readFile(
  new URL("../app/api/servers/[serverId]/voice-move/route.ts", import.meta.url),
  "utf8",
);
function fixture(options = {}) {
  const tables = Object.fromEntries(
    ["channels", "serverMembers"].map((table) => [
      table,
      new Proxy(
        { table },
        { get: (item, key) => (key === "table" ? item.table : key) },
      ),
    ]),
  );
  const rows = {
    serverMembers: [
      {
        userId: actor,
        serverId,
        role: options.owner === false ? "member" : "owner",
      },
      ...(options.member === false ? [] : [{ userId, serverId }]),
    ],
    channels: [
      { id: sourceId, serverId, type: options.sourceType ?? "voice_group" },
      {
        id: destinationId,
        serverId: options.crossServer ? otherServer : serverId,
        type: options.destinationType ?? "voice_direct",
        name: "Lounge",
      },
    ],
  };
  const requests = [];
  const matches = (predicate, row) =>
    predicate.op === "and"
      ? predicate.args.every((value) => matches(value, row))
      : row[predicate.args[0]] === predicate.args[1];
  const exports = {};
  vm.runInNewContext(
    ts.transpile(route, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      process: { env: { SIGNALING_INTERNAL_SECRET: "test-only" } },
      fetch: async (url, request) => {
        requests.push({ url, body: JSON.parse(request.body) });
        if (options.networkError) throw new Error("offline");
        return { ok: !options.status, status: options.status ?? 204 };
      },
      require: (name) =>
        ({
          "drizzle-orm": Object.fromEntries(
            ["and", "eq"].map((op) => [op, (...args) => ({ op, args })]),
          ),
          "next/server": { NextResponse: { json: Response.json } },
          "../../../../../auth": {
            auth: async () =>
              options.authenticated === false ? null : { user: { id: actor } },
          },
          "../../../../../db/schema": tables,
          "../../../../../server/rate-limit": {
            rateLimits: { adminMutation: {} },
            checkRateLimit: () => ({
              allowed: !options.limited,
              retryAfterSeconds: 2,
            }),
          },
          "../../../../../db": {
            db: {
              select: () => ({
                from: (table) => ({
                  where: async (predicate) =>
                    rows[table.table].filter((row) => matches(predicate, row)),
                }),
              }),
            },
          },
        })[name],
    },
  );
  return {
    requests,
    run: (body = { userId, channelId: sourceId, destinationId }) =>
      exports.POST(
        new Request("http://local/voice-move", {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
        { params: Promise.resolve({ serverId }) },
      ),
  };
}

test("voice move API enforces owner, target membership, same-server voice channels and rate limits", async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401],
    [{ owner: false }, 403],
    [{ member: false }, 404],
    [{ crossServer: true }, 404],
    [{ sourceType: "text" }, 404],
    [{ destinationType: "text" }, 404],
    [{ limited: true }, 429],
  ]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, status);
    assert.equal(f.requests.length, 0);
  }
  for (const body of [
    "invalid",
    {},
    { userId: actor, channelId: sourceId, destinationId },
    { userId, channelId: sourceId, destinationId: sourceId },
  ]) {
    const f = fixture();
    assert.equal((await f.run(body)).status, 400);
    assert.equal(f.requests.length, 0);
  }
});

test("voice move sends only the validated destination and reports delivery or capacity failures", async () => {
  const f = fixture();
  assert.equal((await f.run()).status, 200);
  assert.deepEqual(f.requests[0].body, {
    userId,
    roomId: sourceId,
    channel: {
      id: destinationId,
      serverId,
      name: "Lounge",
      type: "voice_direct",
    },
  });
  for (const [options, status] of [
    [{ status: 409 }, 409],
    [{ status: 404 }, 404],
    [{ status: 500 }, 502],
    [{ status: 426 }, 502],
    [{ networkError: true }, 502],
  ])
    assert.equal((await fixture(options).run()).status, status);
  const unsupported = await fixture({ status: 426 }).run();
  assert.match(
    (await unsupported.json()).error,
    /restarted with the latest code/,
  );
});

test("connecting rows appear locally before a socket exists, deduplicate actual occupants and clear on cancellation", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let declaration;
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "updatePendingVoice"
    )
      declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const pending = { current: "" },
    socket = { current: null };
  let presence = { [sourceId]: [{ userId: "other", name: "Other" }] };
  const sent = [];
  const update = vm.runInNewContext(
    `${ts.transpile(declaration)}; updatePendingVoice`,
    {
      pendingVoiceChannel: pending,
      presenceSocket: socket,
      WebSocket: { OPEN: 1 },
      session: { user: { id: userId, name: "Joining" } },
      setVoicePresence: (change) => {
        presence = change(presence);
      },
    },
  );
  update(sourceId, true);
  assert.equal(pending.current, sourceId);
  assert.equal(presence[sourceId][1].connecting, true);
  socket.current = {
    readyState: 1,
    send: (value) => sent.push(JSON.parse(value)),
  };
  update(sourceId, true);
  assert.equal(presence[sourceId].length, 2);
  assert.deepEqual(sent[0], {
    type: "set-voice-pending",
    roomId: sourceId,
    present: true,
  });
  update(sourceId, false);
  assert.equal(pending.current, "");
  assert.equal(presence[sourceId].length, 1);
  presence[sourceId].push({ userId, name: "Connected" });
  update(sourceId, true);
  assert.equal(presence[sourceId].length, 2);
  update(sourceId, false);
  assert.equal(
    presence[sourceId].length,
    2,
    "clearing pending presence must preserve real occupants",
  );
});

test("voice move client ignores stale source rooms and joins the supplied server's channel", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0].getText(ast).includes("moveVoiceRef.current =")
    )
      effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const ref = { current: null },
    joined = [];
  vm.runInNewContext(ts.transpile(`(${effect})();`), {
    moveVoiceRef: ref,
    activeVoiceChannelRef: { current: sourceId },
    selectVoiceChannel: (channel) => joined.push(channel),
    setNoticeMessage() {},
  });
  const channel = {
    id: destinationId,
    serverId,
    name: "Lounge",
    type: "voice_direct",
  };
  ref.current({ roomId: "old", channel });
  ref.current({ roomId: sourceId, channel: { ...channel, type: "text" } });
  assert.equal(joined.length, 0);
  ref.current({ roomId: sourceId, channel });
  assert.deepEqual(joined, [channel]);
});
