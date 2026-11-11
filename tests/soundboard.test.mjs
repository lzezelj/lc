import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  checkRateLimit,
  resetRateLimitsForTests,
} from "../server/rate-limit.ts";

async function moduleAt(path, deps = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      Response,
      URL,
      Uint8Array,
      DataView,
      Buffer,
      ...globals,
    },
  );
  return exports;
}
const { SoundCache, SoundPlayer, SoundCooldown } = await moduleAt(
  "../app/soundboard-audio.ts",
);
const catalog = await moduleAt("./sound-wave.ts");
const uploads = await moduleAt("../server/sound-upload.ts");
const trimming = await moduleAt("../app/sound-trim.ts");

test("trim controls keep extreme, crossed and moved selections playable below the API limit", () => {
  for (const duration of [
    0.005,
    0.2,
    9.99,
    10,
    10.001,
    480001 / 48000,
    12,
    300,
  ]) {
    let start = 0,
      end = Math.min(duration, trimming.soundTrimLimitSeconds);
    for (const boundary of ["start", "end", "selection"]) {
      for (const value of [-100, 0, duration / 2, duration, duration + 100]) {
        ({ start, end } = trimming.adjustSoundTrim(
          duration,
          start,
          end,
          boundary,
          value,
        ));
        assert.ok(start >= 0 && end <= duration + 1e-9 && end > start);
        assert.ok(end - start <= 10 + 1e-9);
        const bytes = trimming.trimSoundWave(
          {
            sampleRate: 48000,
            numberOfChannels: 1,
            length: Math.round(duration * 48000),
            getChannelData: () =>
              new Float32Array(Math.round(duration * 48000)),
          },
          start,
          end,
        );
        assert.ok(uploads.validateSoundWave(bytes));
      }
    }
  }
});

test("sound trimming preserves selected PCM frames and stereo channel order in valid WAVs", () => {
  for (const channels of [1, 2]) {
    const rate = 8000;
    const source = {
      sampleRate: rate,
      numberOfChannels: channels,
      length: 12 * rate,
      getChannelData: (channel) =>
        Float32Array.from({ length: 12 * rate }, (_, i) =>
          i < rate ? 0 : channel === 0 ? 0.5 : -0.5,
        ),
    };
    const bytes = trimming.trimSoundWave(source, 1, 11);
    assert.equal(uploads.validateSoundWave(bytes).durationMs, 10000);
    assert.equal(bytes.length, 44 + 10 * rate * channels * 2);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getInt16(44, true), 16384);
    if (channels === 2) assert.equal(view.getInt16(46, true), -16384);
    for (const [start, end] of [
      [-1, 1],
      [0, 11],
      [3, 2],
      [1, 1],
      [11, 13],
      [NaN, 2],
      [0, Infinity],
      [0, 0.000001],
    ])
      assert.throws(() => trimming.trimSoundWave(source, start, end));
  }
});

test("local sound decoding bounds source size, duration and channels and handles unsupported audio", async () => {
  let result = { length: 48000, duration: 1, numberOfChannels: 2 };
  let calls = 0;
  const decoder = await moduleAt(
    "../app/sound-trim.ts",
    {},
    {
      OfflineAudioContext: class {
        constructor(channels, length, rate) {
          assert.equal(rate, 48000);
        }
        async decodeAudioData() {
          calls++;
          if (result instanceof Error) throw result;
          return result;
        }
      },
    },
  );
  const file = { size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
  for (const size of [0, trimming.maxSoundSourceBytes + 1])
    await assert.rejects(decoder.decodeSoundFile({ ...file, size }), /25 MiB/);
  assert.equal(calls, 0);
  assert.equal(await decoder.decodeSoundFile(file), result);
  result = { length: 1, duration: 301, numberOfChannels: 2 };
  await assert.rejects(decoder.decodeSoundFile(file), /5 minutes/);
  result = { length: 1, duration: 1, numberOfChannels: 6 };
  await assert.rejects(decoder.decodeSoundFile(file), /mono or stereo/);
  result = new Error("decode failed");
  await assert.rejects(decoder.decodeSoundFile(file), /could not be decoded/);
});
const serverId = "11111111-1111-4111-8111-111111111111";
const clipId = "22222222-2222-4222-8222-222222222222";

test("server join sound changes require membership and a sound from the same server", async () => {
  async function fixture({
    role = "owner",
    authenticated = true,
    soundExists = true,
    limited = false,
    accountRole = "member",
  } = {}) {
    const members = {
      serverId: "member.server",
      userId: "member.user",
      joinSoundId: "member.join",
      leaveSoundId: "member.leave",
    };
    const sounds = { id: "sound.id", serverId: "sound.server" };
    const servers = { id: "server.id", joinSoundId: "server.join" };
    const writes = [],
      writeScopes = [],
      predicates = [],
      notifications = [];
    const db = {
      select: () => ({
        from: (table) => ({
          where: (predicate) => {
            predicates.push(predicate);
            return {
              for: async () =>
                table === members
                  ? role
                    ? [{ role }]
                    : []
                  : soundExists
                    ? [{ id: clipId }]
                    : [],
            };
          },
        }),
      }),
      update: (table) => ({
        set: (value) => ({
          where: (scope) => {
            writeScopes.push([table, scope]);
            return {
              returning: async () => {
                writes.push(value);
                return [value];
              },
            };
          },
        }),
      }),
      transaction: async (callback) => callback(db),
    };
    const route = await moduleAt(
      "../app/api/servers/[serverId]/join-sound/route.ts",
      {
        "drizzle-orm": {
          and: (...values) => values,
          eq: (...values) => values,
        },
        "next/server": { NextResponse: { json: Response.json } },
        "../../../../../auth": {
          auth: async () =>
            authenticated ? { user: { id: "actor", role: accountRole } } : null,
        },
        "../../../../../db": { db },
        "../../../../../db/schema": {
          serverMembers: members,
          servers,
          serverSounds: sounds,
        },
        "../../../../../server/rate-limit": {
          checkRateLimit: () => ({ allowed: !limited, retryAfterSeconds: 10 }),
          rateLimits: { serverMutation: {} },
        },
        "../../../../../server/notify-user": {
          notifyUser: async (userId, event) =>
            notifications.push({ userId, event }),
        },
      },
    );
    const saveFields = (fields) =>
      route.PATCH(
        new Request("https://lc.test/join-sound", {
          method: "PATCH",
          body: JSON.stringify(fields),
        }),
        { params: Promise.resolve({ serverId }) },
      );
    const save = (joinSoundId) => saveFields({ joinSoundId });
    return { save, saveFields, writes, writeScopes, predicates, notifications };
  }
  for (const [options, value, status] of [
    [{ authenticated: false }, clipId, 401],
    [{ role: null }, clipId, 403],
    [{ soundExists: false }, clipId, 404],
    [{ limited: true }, clipId, 429],
    [{}, "not-a-sound", 400],
  ]) {
    const current = await fixture(options);
    assert.equal((await current.save(value)).status, status);
    assert.equal(current.writes.length, 0);
    assert.equal(current.notifications.length, 0);
  }
  const current = await fixture();
  assert.equal((await current.save(clipId)).status, 200);
  const moderator = await fixture({ role: "mod" });
  assert.equal((await moderator.save(clipId)).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(current.predicates[1])), [
    ["sound.id", clipId],
    ["sound.server", serverId],
  ]);
  assert.equal(current.writes[0].joinSoundId, clipId);
  assert.equal((await current.save(null)).status, 200);
  assert.equal(current.writes[1].joinSoundId, null, "Default persists as null");
  assert.equal(current.notifications.length, 2);
  assert.ok(
    current.notifications.every(
      (notice) =>
        notice.userId === "actor" &&
        notice.event.type === "voice-sounds-changed" &&
        notice.event.serverId === serverId,
    ),
  );
  assert.equal(
    (await current.saveFields({ joinSoundId: clipId, userId: "another-user" }))
      .status,
    200,
  );
  assert.equal(current.writes[2].joinSoundId, clipId);
  assert.deepEqual(
    JSON.parse(JSON.stringify(current.writeScopes[2][1])),
    [
      ["member.server", serverId],
      ["member.user", "actor"],
    ],
    "writes must use the signed-in member, never a supplied user ID",
  );
  for (const accountRole of ["member", "demo"]) {
    const member = await fixture({ role: "member", accountRole });
    assert.equal((await member.save(clipId)).status, 200);
    assert.equal((await member.save(null)).status, 200);
    assert.equal(
      member.writes.length,
      2,
      "members can change only the join-sound field",
    );
    assert.deepEqual(Object.keys(member.writes[0]), ["joinSoundId"]);
  }
});

test("custom joins publish only from the arriving client; listeners never download or play the clip locally", async () => {
  const tones = [],
    published = [];
  let clip = clipId,
    resolveRequest;
  let metadata = async () => Response.json({ joinSoundId: clip });
  const { ServerJoinSound } = await moduleAt(
    "../app/server-join-sound.ts",
    {
      "./call-sounds": { playVoiceSound: (type) => tones.push(type) },
    },
    {
      fetch: async (url) => {
        assert.equal(
          url,
          `/api/servers/${serverId}/join-sound?userId=arriving-user`,
        );
        return metadata();
      },
      Audio: class {
        constructor() {
          throw new Error("Custom joins must not create local file playback");
        }
      },
    },
  );
  const player = new ServerJoinSound();
  player.update({ serverId, outputVolume: 50 });
  await player.play("arriving-user", async (id) => published.push(id));
  assert.deepEqual(published, [clipId]);
  await player.play("arriving-user");
  assert.deepEqual(
    tones,
    [],
    "listeners wait for the incoming soundboard track",
  );
  player.update({ serverId, deafened: true });
  await player.play("arriving-user", async (id) => published.push(id));
  assert.equal(
    published.length,
    2,
    "deafen silences monitoring without suppressing the outgoing soundboard clip",
  );
  metadata = () =>
    new Promise((resolve) => {
      resolveRequest = resolve;
    });
  const pending = player.play("arriving-user", async (id) =>
    published.push(id),
  );
  player.stop();
  resolveRequest(Response.json({ joinSoundId: clipId }));
  await pending;
  assert.equal(
    published.length,
    2,
    "leaving cancels a pending automatic announcement",
  );
  clip = null;
  metadata = async () => Response.json({ joinSoundId: clip });
  player.update({ serverId, outputVolume: 50 });
  await player.play("arriving-user");
  assert.deepEqual(tones, ["join"]);
});

test("voice sound preference refresh updates only server sound metadata and preserves message state", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let declaration;
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "applyVoiceSoundSettings"
    )
      declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const other = { id: "other", joinSoundId: null };
  let servers = [{ id: serverId, joinSoundId: null }, other];
  const messages = [{ id: "existing", text: "Loaded history" }];
  const scope = {
    setServers: (update) => {
      servers = update(servers);
    },
    fetch() {
      throw new Error(
        "A preference save must not refetch messages or channels",
      );
    },
    setMessages() {
      throw new Error("Message history must remain untouched");
    },
    messages,
  };
  const apply = vm.runInNewContext(
    `${ts.transpile(declaration)}; applyVoiceSoundSettings`,
    scope,
  );
  apply(serverId, clipId);
  assert.equal(servers[0].joinSoundId, clipId);
  assert.equal(servers[1], other);
  assert.equal(scope.messages, messages);
});

test("native join announcement waits for a connected media path and publishes only once", async () => {
  const source = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let handler;
  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(ast) === "peer.onconnectionstatechange"
    )
      handler = node.right.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const peer = { connectionState: "connecting" },
    calls = [];
  const pending = { current: true },
    connection = { current: peer };
  const publish = () => {};
  const run = vm.runInNewContext(
    `${ts.transpile(`const callback = ${handler};`)}; callback`,
    {
      peer,
      connection,
      pendingJoinAnnouncement: pending,
      nativeAudioGate: { current: null },
      directTransmitBlockedRef: { current: false },
      session: { user: { id: "self" } },
      publishDirectSound: publish,
      soundboard: { playJoinSound: (...args) => calls.push(args) },
      setStatus() {},
    },
  );
  run();
  assert.equal(calls.length, 0);
  peer.connectionState = "connected";
  run();
  run();
  assert.deepEqual(calls, [["self", publish]]);
  pending.current = true;
  connection.current = null;
  run();
  assert.equal(
    calls.length,
    1,
    "obsolete connection callbacks cannot publish after leaving",
  );
});

async function customRoute({
  authenticated = true,
  role = "owner",
  lockedRole = role,
  total = 0,
  limited = false,
  existing = true,
} = {}) {
  const members = { userId: "userId", serverId: "memberServerId" };
  const servers = { id: "server.id" };
  const sounds = Object.fromEntries(
    ["id", "name", "serverId", "audio", "durationMs", "createdAt"].map(
      (key) => [key, `sound.${key}`],
    ),
  );
  const writes = [],
    predicates = [],
    locks = [],
    notifications = [];
  let memberReads = 0;
  const db = {
    select(fields) {
      return {
        from(table) {
          let predicate;
          const rows = () =>
            table === servers
              ? [{ id: serverId }]
              : table === members
                ? memberReads++ === 0
                  ? role
                    ? [{ role, userId: "actor" }]
                    : []
                  : lockedRole
                    ? [{ role: lockedRole, userId: "actor" }]
                    : []
                : fields?.value
                  ? [{ value: total }]
                  : fields?.audio
                    ? existing
                      ? [{ audio: Buffer.from(catalog.soundWave("chime-v1")) }]
                      : []
                    : existing
                      ? [
                          {
                            id: clipId,
                            name: "Custom",
                            serverId,
                            durationMs: 600,
                          },
                        ]
                      : [];
          const query = {
            where(value) {
              predicate = value;
              predicates.push(value);
              return query;
            },
            for(mode) {
              locks.push([mode, predicate]);
              return Promise.resolve(rows());
            },
            orderBy() {
              return Promise.resolve(rows());
            },
            then(resolve, reject) {
              return Promise.resolve(rows()).then(resolve, reject);
            },
          };
          return query;
        },
      };
    },
    insert() {
      return {
        values(value) {
          writes.push(["insert", value]);
          return {
            returning: async () => [
              {
                id: clipId,
                name: value.name,
                serverId: value.serverId,
                durationMs: value.durationMs,
              },
            ],
          };
        },
      };
    },
    delete() {
      return {
        where(value) {
          writes.push(["delete", value]);
          return { returning: async () => (existing ? [{ id: clipId }] : []) };
        },
      };
    },
    transaction: async (callback) => callback(db),
  };
  const route = await moduleAt(
    "../app/api/servers/[serverId]/soundboard/route.ts",
    {
      "drizzle-orm": {
        and: (...args) => args,
        eq: (...args) => args,
        asc: (value) => value,
        count: () => ({ count: true }),
      },
      "next/server": { NextResponse: { json: Response.json } },
      "../../../../../auth": {
        auth: async () => (authenticated ? { user: { id: "actor" } } : null),
      },
      "../../../../../db": { db },
      "../../../../../db/schema": {
        serverMembers: members,
        serverSounds: sounds,
        servers,
      },
      "../../../../../server/sound-upload": uploads,
      "../../../../../server/notify-user": {
        notifyUser: async (userId, event) =>
          notifications.push({ userId, ...event }),
      },
      "../../../../../server/rate-limit": {
        checkRateLimit: () => ({ allowed: !limited, retryAfterSeconds: 12 }),
      },
    },
  );
  return { route, writes, predicates, locks, notifications };
}
const params = { params: Promise.resolve({ serverId }) };
const uploadRequest = (
  bytes = catalog.soundWave("chime-v1"),
  name = "Custom",
) =>
  new Request(`https://lc.test/soundboard?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body: bytes,
  });

test("new boards contain no default sounds and removed default IDs return 404", async () => {
  const fixture = await customRoute({ existing: false });
  const list = await fixture.route.GET(
    new Request("https://lc.test/soundboard"),
    params,
  );
  assert.deepEqual((await list.json()).sounds, []);
  const audio = await fixture.route.GET(
    new Request("https://lc.test/soundboard?clip=chime-v1"),
    params,
  );
  assert.equal(audio.status, 404);
});

test("ten seconds of 48 kHz stereo PCM fits within the 2 MiB upload boundary", () => {
  const audio = new Uint8Array(44 + 48000 * 2 * 2 * 10);
  audio.set(catalog.soundWave("chime-v1").subarray(0, 44));
  const view = new DataView(audio.buffer);
  view.setUint32(4, audio.length - 8, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, 48000, true);
  view.setUint32(28, 192000, true);
  view.setUint16(32, 4, true);
  view.setUint32(40, audio.length - 44, true);
  assert.equal(audio.length, 1920044);
  assert.ok(audio.length < uploads.maxSoundBytes);
  assert.equal(uploads.validateSoundWave(audio).durationMs, 10000);
  for (const frames of [480480, 480481]) {
    const margin = new Uint8Array(44 + frames * 4);
    margin.set(audio.subarray(0, 44));
    const marginView = new DataView(margin.buffer);
    marginView.setUint32(4, margin.length - 8, true);
    marginView.setUint32(40, margin.length - 44, true);
    if (frames === 480480)
      assert.equal(uploads.validateSoundWave(margin).durationMs, 10010);
    else assert.equal(uploads.validateSoundWave(margin), null);
  }
});

test("client cooldown rejects rapid attempts without extending the one-second deadline", () => {
  const cooldown = new SoundCooldown();
  assert.equal(cooldown.take(1000), true);
  assert.equal(cooldown.take(1000), false);
  assert.equal(cooldown.take(1999), false);
  assert.equal(cooldown.take(2000), true);
});

async function playbackRoute({
  authenticated = true,
  member = true,
  sound = true,
  userId = "actor",
  now = () => 1000,
} = {}) {
  const predicates = [];
  const route = await moduleAt(
    "../app/api/servers/[serverId]/soundboard/play/route.ts",
    {
      "drizzle-orm": { and: (...args) => args, eq: (...args) => args },
      "next/server": { NextResponse: { json: Response.json } },
      "../../../../../../auth": {
        auth: async () => (authenticated ? { user: { id: userId } } : null),
      },
      "../../../../../../db/schema": {
        serverMembers: { userId: "userId", serverId: "memberServer" },
        serverSounds: { id: "soundId", serverId: "soundServer" },
      },
      "../../../../../../db": {
        db: {
          select: (fields) => ({
            from: () => ({
              where: async (predicate) => {
                predicates.push(predicate);
                return (fields.userId ? member : sound) ? [{}] : [];
              },
            }),
          }),
        },
      },
      "../../../../../../server/rate-limit": {
        checkRateLimit: (key, policy) => checkRateLimit(key, policy, now()),
      },
    },
  );
  return { route, predicates };
}
const playRequest = () =>
  new Request(`https://lc.test/soundboard/play?clip=${clipId}`, {
    method: "POST",
  });

test("server playback permits require membership and a server-scoped existing clip", async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401],
    [{ member: false }, 403],
    [{ sound: false }, 404],
  ]) {
    const fixture = await playbackRoute(options);
    assert.equal(
      (await fixture.route.POST(playRequest(), params)).status,
      status,
    );
  }
  resetRateLimitsForTests();
  const fixture = await playbackRoute();
  assert.equal((await fixture.route.POST(playRequest(), params)).status, 200);
  assert.equal(
    JSON.stringify(fixture.predicates[1]),
    JSON.stringify([
      ["soundId", clipId],
      ["soundServer", serverId],
    ]),
  );
});

test("server playback limit is per account across clips, tabs and servers and permits again at one second", async () => {
  resetRateLimitsForTests();
  let now = 1000;
  const first = await playbackRoute({ now: () => now });
  const secondTab = await playbackRoute({ now: () => now });
  assert.equal((await first.route.POST(playRequest(), params)).status, 200);
  now = 1999;
  const denied = await secondTab.route.POST(playRequest(), {
    params: Promise.resolve({ serverId: clipId }),
  });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "1");
  const otherUser = await playbackRoute({ userId: "other", now: () => now });
  assert.equal((await otherUser.route.POST(playRequest(), params)).status, 200);
  now = 2000;
  assert.equal((await first.route.POST(playRequest(), params)).status, 200);
});

test("custom mutations require server ownership, rate limits, and an ownership recheck under lock", async () => {
  for (const [options, status] of [
    [{ authenticated: false }, 401],
    [{ role: null }, 403],
    [{ role: "member" }, 403],
    [{ limited: true }, 429],
    [{ lockedRole: "member" }, 403],
    [{ total: 20 }, 409],
  ]) {
    for (const method of ["POST", "DELETE"]) {
      if (method === "DELETE" && options.total) continue;
      const fixture = await customRoute(options);
      const request =
        method === "POST"
          ? uploadRequest()
          : new Request(`https://lc.test/soundboard?clip=${clipId}`, {
              method,
            });
      const response = await fixture.route[method](request, params);
      assert.equal(response.status, status);
      assert.equal(fixture.writes.length, 0);
      if (status === 429)
        assert.equal(response.headers.get("retry-after"), "12");
    }
  }
});

test("moderators may upload but cannot remove sounds; demotion revokes uploads before persistence", async () => {
  const mod = await customRoute({ role: "mod" });
  assert.equal((await mod.route.POST(uploadRequest(), params)).status, 201);
  assert.deepEqual(mod.locks[0], ["update", ["server.id", serverId]]);
  assert.equal(
    mod.locks.length,
    2,
    "The shared server lock precedes the uploader membership lock",
  );
  const denied = await customRoute({ role: "mod" });
  assert.equal(
    (
      await denied.route.DELETE(
        new Request(`https://lc.test/soundboard?clip=${clipId}`, {
          method: "DELETE",
        }),
        params,
      )
    ).status,
    403,
  );
  assert.equal(denied.writes.length, 0);
  const demoted = await customRoute({ role: "mod", lockedRole: "member" });
  assert.equal((await demoted.route.POST(uploadRequest(), params)).status, 403);
  assert.equal(demoted.writes.length, 0);
  const full = await customRoute({ role: "mod", total: 20 });
  assert.equal((await full.route.POST(uploadRequest(), params)).status, 409);
  const metadata = await customRoute({ role: "mod" });
  const permissions = await (
    await metadata.route.GET(new Request("https://lc.test/soundboard"), params)
  ).json();
  assert.equal(permissions.canUpload, true);
  assert.equal(permissions.canManage, false);
});

test("uploads persist validated bytes and metadata; deletion and audio reads are scoped to the server", async () => {
  const fixture = await customRoute();
  const response = await fixture.route.POST(uploadRequest(), params);
  assert.equal(response.status, 201);
  assert.deepEqual(
    fixture.notifications.map((event) => ({ ...event })),
    [{ userId: "actor", type: "soundboard-updated", serverId }],
  );
  const sound = await response.json();
  assert.equal(sound.custom, true);
  assert.equal(sound.durationMs, 600);
  assert.ok(!("audio" in sound));
  assert.deepEqual(
    fixture.writes[0][1].audio,
    Buffer.from(catalog.soundWave("chime-v1")),
  );
  assert.equal(fixture.locks[0][0], "update");
  const deletion = await customRoute();
  assert.equal(
    (
      await deletion.route.DELETE(
        new Request(`https://lc.test/soundboard?clip=${clipId}`, {
          method: "DELETE",
        }),
        params,
      )
    ).status,
    200,
  );
  assert.equal(
    JSON.stringify(deletion.writes[0][1]),
    JSON.stringify([
      ["sound.id", clipId],
      ["sound.serverId", serverId],
    ]),
  );
  const reader = await customRoute({ role: "member" });
  assert.equal(deletion.notifications[0].type, "soundboard-updated");
  const audio = await reader.route.GET(
    new Request(`https://lc.test/soundboard?clip=${clipId}`),
    params,
  );
  assert.equal(audio.status, 200);
  assert.equal(audio.headers.get("content-type"), "audio/wav");
  assert.equal(
    JSON.stringify(reader.predicates.at(-1)),
    JSON.stringify([
      ["sound.id", clipId],
      ["sound.serverId", serverId],
    ]),
  );
  const missing = await customRoute({ existing: false });
  assert.equal(
    (
      await missing.route.GET(
        new Request(`https://lc.test/soundboard?clip=${clipId}`),
        params,
      )
    ).status,
    404,
  );
});

test("invalid names, forged audio, oversized bodies and built-in deletions cannot write storage", async () => {
  for (const request of [
    uploadRequest(undefined, " "),
    uploadRequest(undefined, "x".repeat(61)),
    uploadRequest(new Uint8Array(44)),
    uploadRequest(new Uint8Array(2097153)),
  ]) {
    const fixture = await customRoute();
    assert.ok(
      [400, 413].includes((await fixture.route.POST(request, params)).status),
    );
    assert.equal(fixture.writes.length, 0);
  }
  const fixture = await customRoute();
  assert.equal(
    (
      await fixture.route.DELETE(
        new Request("https://lc.test/soundboard?clip=chime-v1", {
          method: "DELETE",
        }),
        params,
      )
    ).status,
    400,
  );
  assert.equal(fixture.writes.length, 0);
});

test("WAV validation checks actual encoding, chunk boundaries, sample alignment and duration", () => {
  assert.equal(
    uploads.validateSoundWave(catalog.soundWave("chime-v1")).durationMs,
    600,
  );
  for (const [offset, value, width] of [
    [20, 3, 2],
    [22, 5, 2],
    [24, 0, 4],
    [28, 1, 4],
    [32, 7, 2],
    [34, 24, 2],
    [40, 999999, 4],
  ]) {
    const bytes = catalog.soundWave("chime-v1").slice();
    const view = new DataView(bytes.buffer);
    if (width === 2) view.setUint16(offset, value, true);
    else view.setUint32(offset, value, true);
    assert.equal(uploads.validateSoundWave(bytes), null);
  }
  const long = new Uint8Array(44 + 24000 * 2 * 11);
  long.set(catalog.soundWave("chime-v1").subarray(0, 44));
  const view = new DataView(long.buffer);
  view.setUint32(4, long.length - 8, true);
  view.setUint32(40, long.length - 44, true);
  assert.equal(uploads.validateSoundWave(long), null);
});

test("streamed uploads are bounded even without a Content-Length header", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(600000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://lc.test/upload", {
    method: "POST",
    body,
    duplex: "half",
  });
  assert.equal(await uploads.readSoundBody(request), null);
  assert.equal(cancelled, true);
});

test("generated test WAVs are valid PCM and unknown fixture IDs cannot resolve paths", () => {
  for (const sound of catalog.starterSounds) {
    const audio = catalog.soundWave(sound.id);
    assert.equal(Buffer.from(audio.subarray(0, 4)).toString(), "RIFF");
    const view = new DataView(audio.buffer);
    assert.equal(view.getUint16(22, true), 1);
    assert.equal(view.getUint32(24, true), 24000);
    assert.equal(view.getUint32(40, true), audio.length - 44);
    assert.ok(audio.length < 50000);
    assert.ok(audio.subarray(44).some((value) => value !== 0));
  }
  assert.equal(catalog.soundWave("../../private"), null);
});

test("metadata and audio each require current session and target server membership", async () => {
  for (const clip of ["", `?clip=${clipId}`]) {
    for (const access of ["anonymous", "outsider", "member"]) {
      const predicates = [];
      const route = await moduleAt(
        "../app/api/servers/[serverId]/soundboard/route.ts",
        {
          "drizzle-orm": {
            and: (...args) => args,
            eq: (...args) => args,
            asc: (value) => value,
          },
          "next/server": { NextResponse: { json: Response.json } },
          "../../../../../auth": {
            auth: async () =>
              access === "anonymous" ? null : { user: { id: "actor" } },
          },
          "../../../../../db": {
            db: {
              select: () => ({
                from: (table) =>
                  table === "sounds"
                    ? {
                        where: () =>
                          clip
                            ? Promise.resolve([
                                { audio: catalog.soundWave("chime-v1") },
                              ])
                            : { orderBy: async () => [] },
                      }
                    : {
                        where: async (predicate) => {
                          predicates.push(predicate);
                          return access === "member" ? [{}] : [];
                        },
                      },
              }),
            },
          },
          "../../../../../db/schema": {
            serverMembers: { userId: "userId", serverId: "serverId" },
            serverSounds: "sounds",
          },
          "../../../../../server/sound-upload": uploads,
          "../../../../../server/notify-user": {
            notifyUser: async () => {},
          },
          "../../../../../server/rate-limit": {
            checkRateLimit: () => ({ allowed: true }),
          },
        },
      );
      const response = await route.GET(
        new Request(
          `https://lc.test/api/servers/${serverId}/soundboard${clip}`,
        ),
        { params: Promise.resolve({ serverId }) },
      );
      assert.equal(
        response.status,
        access === "anonymous" ? 401 : access === "outsider" ? 403 : 200,
      );
      if (access !== "anonymous")
        assert.equal(
          JSON.stringify(predicates[0]),
          JSON.stringify([
            ["userId", "actor"],
            ["serverId", serverId],
          ]),
        );
      if (access === "member") {
        assert.equal(
          response.headers.get("cache-control"),
          "private, no-store",
        );
        if (clip)
          assert.equal(response.headers.get("content-type"), "audio/wav");
        else
          assert.ok(
            (await response.json()).sounds.every(
              (sound) => sound.serverId === serverId && !sound.notes,
            ),
          );
      }
    }
  }
});

test("cache reuses clips, separates servers, evicts least recently used by bytes and count", async () => {
  const cache = new SoundCache(6, 2);
  let loads = 0;
  const get = (key) =>
    cache.get(key, async () => {
      loads++;
      return new ArrayBuffer(3);
    });
  const first = await get("server-a/chime");
  await get("server-b/chime");
  assert.equal(await get("server-a/chime"), first);
  assert.equal(loads, 2);
  await get("server-c/chime");
  await get("server-b/chime");
  assert.equal(loads, 4);
  await assert.rejects(
    cache.get("huge", async () => new ArrayBuffer(7)),
    /too large/,
  );
  await assert.rejects(
    cache.get("failed", async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  assert.equal((await get("failed")).byteLength, 3);
});

function audioFixture() {
  const tracks = [],
    sources = [];
  const context = {
    decodeAudioData: async (bytes) => bytes,
    createMediaStreamDestination() {
      const track = {
        stopped: false,
        stop() {
          this.stopped = true;
        },
      };
      tracks.push(track);
      return { stream: { getAudioTracks: () => [track] } };
    },
    createBufferSource() {
      const source = {
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    },
  };
  return { context, tracks, sources };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("stop during download prevents publication; leaving during publish releases the late track", async () => {
  const player = new SoundPlayer();
  const audio = audioFixture();
  const load = deferred();
  let publications = 0,
    removals = 0;
  const publish = deferred();
  const pending = player.play(
    audio.context,
    () => load.promise,
    async () => {
      publications++;
      return () => removals++;
    },
  );
  player.stop();
  load.resolve(new ArrayBuffer(4));
  await pending;
  assert.equal(publications, 0);
  const next = player.play(
    audio.context,
    async () => new ArrayBuffer(4),
    async () => {
      publications++;
      await publish.promise;
      return () => removals++;
    },
  );
  await tick();
  player.stop();
  assert.equal(audio.tracks[0].stopped, true);
  publish.resolve();
  await next;
  assert.equal(removals, 1);
  assert.equal(audio.sources[0].started, false);
});

test("playback uses its own track; replacement, natural completion and publication failure clean up", async () => {
  const player = new SoundPlayer();
  const audio = audioFixture();
  let removals = 0;
  const play = () =>
    player.play(
      audio.context,
      async () => new ArrayBuffer(4),
      async (track) => {
        assert.ok(audio.tracks.includes(track));
        return () => removals++;
      },
    );
  await play();
  assert.equal(audio.sources[0].started, true);
  await play();
  assert.equal(removals, 1);
  assert.equal(audio.tracks[0].stopped, true);
  audio.sources[1].onended();
  assert.equal(removals, 2);
  assert.equal(audio.tracks[1].stopped, true);
  await assert.rejects(
    player.play(
      audio.context,
      async () => new ArrayBuffer(4),
      async () => {
        throw new Error("disconnected");
      },
    ),
    /disconnected/,
  );
  assert.equal(audio.tracks[2].stopped, true);
});

test("published audio monitoring starts only after publication and is released on completion", async () => {
  const audio = audioFixture();
  const monitored = [];
  let releases = 0;
  const player = new SoundPlayer((track) => {
    monitored.push(track);
    return () => releases++;
  });
  await player.play(
    audio.context,
    async () => new ArrayBuffer(4),
    async () => () => {},
  );
  assert.equal(monitored[0], audio.tracks[0]);
  audio.sources[0].onended();
  assert.equal(releases, 1);
  player.stop();
  assert.equal(releases, 1);
});

test("public playback activity spans silence and clears on completion, replacement, stop and failure", async () => {
  const audio = audioFixture(),
    activity = [];
  const player = new SoundPlayer(
    () => () => {},
    (playing) => activity.push(playing),
  );
  const play = () =>
    player.play(
      audio.context,
      async () => new ArrayBuffer(4),
      async () => () => {},
    );
  await play();
  assert.deepEqual(activity, [true]);
  await play();
  assert.deepEqual(activity, [true, false, true]);
  audio.sources[1].onended();
  assert.deepEqual(activity, [true, false, true, false]);
  player.stop();
  assert.equal(activity.length, 4);
  await assert.rejects(
    player.play(
      audio.context,
      async () => new ArrayBuffer(4),
      async () => {
        throw new Error("failed");
      },
    ),
  );
  assert.equal(
    activity.length,
    4,
    "A failed publication never announces playback",
  );
});
