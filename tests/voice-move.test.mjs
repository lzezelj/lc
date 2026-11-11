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

test("LiveKit moderation updates only the selected account in this server and restores independent permissions", async () => {
  const updates = [],
    exports = {};
  const channels = new Proxy({}, { get: (_, key) => key });
  const code = await readFile(
    new URL("../server/voice-moderation.ts", import.meta.url),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpile(code, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      process: {
        env: {
          LIVEKIT_INTERNAL_URL: "ws://media.invalid",
          LIVEKIT_API_KEY: "test-only",
          LIVEKIT_API_SECRET: "test-only",
        },
      },
      require: (name) =>
        ({
          "drizzle-orm": { eq: (...args) => args, and: (...args) => args },
          "../db/schema": { channels },
          "../app/voice-policy": {
            voiceBlocked: (policy) =>
              Boolean(policy.voiceMuted || policy.voiceDeafened),
          },
          "../db": {
            db: {
              select: () => ({
                from: () => ({
                  where: async (predicate) => {
                    assert.deepEqual(JSON.parse(JSON.stringify(predicate)), [
                      ["serverId", serverId],
                      ["type", "voice_group"],
                    ]);
                    return [{ id: sourceId }];
                  },
                }),
              }),
            },
          },
          "livekit-server-sdk": {
            TrackSource: { CAMERA: 1, SCREEN_SHARE: 3 },
            RoomServiceClient: class {
              async listParticipants(room) {
                assert.equal(room, `channel-${sourceId}`);
                return [
                  userId,
                  `${userId}:session`,
                  `${userId}extra:session`,
                  `${actor}:session`,
                ].map((identity) => ({
                  identity,
                  permission: { canPublishData: true },
                }));
              }
              async updateParticipant(room, identity, options) {
                updates.push({ room, identity, ...options.permission });
              }
            },
          },
        })[name],
    },
  );
  for (const policy of [
    { voiceMuted: true },
    { voiceDeafened: true },
    { voiceMuted: false, voiceDeafened: false },
  ]) {
    updates.length = 0;
    await exports.applyGroupModeration(serverId, userId, policy);
    assert.deepEqual(
      updates.map((update) => update.identity),
      [userId, `${userId}:session`],
    );
    assert.ok(
      updates.every(
        (update) =>
          update.canPublishData &&
          update.canSubscribe === !policy.voiceDeafened,
      ),
    );
    assert.deepEqual(
      [...updates[0].canPublishSources],
      policy.voiceMuted || policy.voiceDeafened ? [1, 3] : [],
    );
  }
});

async function moderationFixture(options = {}) {
  const events = [],
    exports = {};
  const memberTable = new Proxy({}, { get: (_, key) => key });
  const rows = [
    {
      userId: actor,
      serverId,
      role: options.owner === false ? "member" : "owner",
      voiceMuted: false,
      voiceDeafened: false,
    },
    ...(options.member === false
      ? []
      : [
          {
            userId,
            serverId,
            role: options.targetOwner ? "owner" : "member",
            voiceMuted: false,
            voiceDeafened: false,
          },
        ]),
  ];
  const matches = (predicate, row) =>
    predicate.op === "and"
      ? predicate.args.every((p) => matches(p, row))
      : row[predicate.args[0]] === predicate.args[1];
  const db = {
    select: () => ({
      from: () => ({
        where: (predicate) => {
          const result = rows.filter((row) => matches(predicate, row));
          return {
            then: (resolve) => Promise.resolve(result).then(resolve),
            for: async () => result,
          };
        },
      }),
    }),
    update: () => ({
      set: (patch) => ({
        where: (predicate) => ({
          returning: async () => {
            events.push("write");
            const row = rows.find((row) => matches(predicate, row));
            Object.assign(row, patch);
            return [
              { voiceMuted: row.voiceMuted, voiceDeafened: row.voiceDeafened },
            ];
          },
        }),
      }),
    }),
    transaction: async (run) => {
      const result = await run(db);
      events.push("commit");
      return result;
    },
  };
  const dependencies = {
    "drizzle-orm": Object.fromEntries(
      ["and", "eq"].map((op) => [op, (...args) => ({ op, args })]),
    ),
    "../../../../../auth": {
      auth: async () => (options.unauthorized ? null : { user: { id: actor } }),
    },
    "../../../../../db": { db },
    "../../../../../db/schema": { serverMembers: memberTable },
    "../../../../../server/rate-limit": {
      checkRateLimit: () => ({ allowed: !options.limited }),
    },
    "../../../../../server/notify-user": {
      notifyUser: async (id, payload) => events.push({ id, payload }),
    },
    "../../../../../server/voice-moderation": {
      readVoicePolicies: async () =>
        Object.fromEntries(
          rows.map((row) => [
            row.userId,
            { voiceMuted: row.voiceMuted, voiceDeafened: row.voiceDeafened },
          ]),
        ),
      applyGroupModeration: async () => {
        events.push("media");
        if (options.mediaFailure) throw new Error("offline");
      },
    },
  };
  const code = await readFile(
    new URL(
      "../app/api/servers/[serverId]/voice-moderation/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  vm.runInNewContext(
    ts.transpile(code, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      Response,
      require: (name) => {
        assert.ok(name in dependencies, name);
        return dependencies[name];
      },
    },
  );
  const context = { params: Promise.resolve({ serverId }) };
  return {
    rows,
    events,
    get: () => exports.GET(null, context),
    run: (body = { userId, voiceMuted: true }) =>
      exports.PATCH(
        new Request("http://local/moderation", {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
        context,
      ),
  };
}

test("voice moderation rejects unauthorized/non-owner changes, absent targets and invalid flags without side effects", async () => {
  for (const [options, status] of [
    [{ unauthorized: true }, 401],
    [{ owner: false }, 403],
    [{ member: false }, 403],
    [{ targetOwner: true }, 403],
    [{ limited: true }, 429],
  ]) {
    const f = await moderationFixture(options);
    assert.equal((await f.run()).status, status);
    assert.ok(!f.events.includes("write") && !f.events.includes("media"));
  }
  for (const body of [
    { userId },
    { userId: actor, voiceMuted: true },
    { userId, voiceMuted: "true" },
    { userId, voiceDeafened: 1 },
  ]) {
    const f = await moderationFixture();
    assert.equal((await f.run(body)).status, 400);
    assert.deepEqual(f.events, []);
  }
});

test("voice moderation persists independent flags before SFU updates and sends only targeted policy events", async () => {
  const f = await moderationFixture();
  assert.equal((await f.get()).status, 200);
  assert.deepEqual(await (await f.run()).json(), {
    voiceMuted: true,
    voiceDeafened: false,
    mediaSynced: true,
  });
  assert.deepEqual(f.events.slice(0, 3), ["write", "commit", "media"]);
  assert.deepEqual(
    f.events.filter((event) => event.payload).map((event) => event.id),
    [actor, userId],
  );
  assert.ok(
    f.events
      .filter((event) => event.payload)
      .every(
        (event) =>
          event.payload.type === "voice-moderation-changed" &&
          event.payload.serverId === serverId,
      ),
  );
  assert.deepEqual(
    await (await f.run({ userId, voiceDeafened: true })).json(),
    { voiceMuted: true, voiceDeafened: true, mediaSynced: true },
  );
  assert.deepEqual(await (await f.run({ userId, voiceMuted: false })).json(), {
    voiceMuted: false,
    voiceDeafened: true,
    mediaSynced: true,
  });
  const failed = await moderationFixture({ mediaFailure: true });
  assert.equal((await (await failed.run()).json()).mediaSynced, false);
  assert.equal(failed.rows[1].voiceMuted, true);
});
function fixture(options = {}) {
  const tables = Object.fromEntries(
    ["channels", "serverMembers", "servers"].map((table) => [
      table,
      new Proxy(
        { table },
        { get: (item, key) => (key === "table" ? item.table : key) },
      ),
    ]),
  );
  const rows = {
    servers: [
      { id: serverId, afkChannelId: options.afkChannelId ?? destinationId },
    ],
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

test("AFK self-moves allow ordinary members only into their server's configured channel", async () => {
  const body = { userId: actor, channelId: sourceId, destinationId, afk: true };
  const allowed = fixture({ owner: false });
  assert.equal((await allowed.run(body)).status, 200);
  assert.equal(allowed.requests[0].body.userId, actor);
  const wrongDestination = fixture({ owner: false, afkChannelId: sourceId });
  assert.equal((await wrongDestination.run(body)).status, 403);
  assert.equal(wrongDestination.requests.length, 0);
  const otherPerson = fixture({ owner: false });
  assert.equal((await otherPerson.run({ ...body, userId })).status, 403);
  const crossServer = fixture({ owner: false, crossServer: true });
  assert.equal((await crossServer.run(body)).status, 404);
  const text = fixture({ owner: false, destinationType: "text" });
  assert.equal((await text.run(body)).status, 404);
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
