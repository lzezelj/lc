import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createSignalingToken } from "../server/signaling-auth.mjs";
import { createSignalingServer } from "../server/signaling.mjs";
import { createVoiceSessions } from "../server/voice-sessions.mjs";
import { TypingTracker } from "../server/typing.mjs";

const resources = [];
const authSecret = "test-signaling-secret";
const permittedChannelIds = [
  "lounge",
  "interview",
  "other-room",
  "general",
  "random",
  "group-room",
];

test(
  "idle signaling sockets answer heartbeats and unresponsive sockets are removed",
  { timeout: 5000 },
  async () => {
    const url = await startServer({ heartbeatIntervalMs: 60 });
    const healthy = await connect(url, "Heartbeat");
    await once(healthy, "ping");
    await once(healthy, "ping");
    assert.equal(healthy.readyState, WebSocket.OPEN);
    const silent = new WebSocket(healthy.url, { autoPong: false });
    resources.unshift(silent);
    await once(silent, "open");
    await once(silent, "close");
    assert.equal(healthy.readyState, WebSocket.OPEN);
  },
);

test("typing state deduplicates tabs, expires, switches contexts and clears disconnected users", () => {
  let now = 0;
  const updates = [];
  const tracker = new TypingTracker(
    (context, users) => updates.push({ key: context.key, users }),
    () => now,
    6000,
  );
  const channel = { key: "channel:a", channelId: "a" },
    other = { key: "channel:b", channelId: "b" };
  const first = {},
    second = {};
  tracker.update(first, channel, { id: "a", name: "Alice" }, true);
  tracker.update(second, channel, { id: "a", name: "Alice" }, true);
  assert.equal(updates.at(-1).users.length, 1);
  tracker.clear(first);
  assert.equal(updates.at(-1).users.length, 1, "another tab is still typing");
  tracker.update(second, other, { id: "a", name: "Alice" }, true);
  assert.deepEqual(updates.at(-2), { key: channel.key, users: [] });
  tracker.update(second, channel, { id: "a", name: "Alice" }, false);
  assert.equal(
    tracker.entries.size,
    1,
    "late stop from an old context cannot clear the new one",
  );
  now = 6001;
  tracker.expire();
  assert.equal(tracker.entries.size, 0);
  assert.deepEqual(updates.at(-1), { key: other.key, users: [] });
});

test("channel typing uses authenticated names and does not reach unauthorized viewers", async () => {
  const url = await startServer();
  const alice = await connect(url, "Typing Alice", ["general"]);
  const bob = await connect(url, "Typing Bob", ["general"]);
  const outsider = await connect(url, "Typing outsider", ["random"]);
  const bobReady = nextMessage(bob),
    outsiderReady = nextMessage(outsider);
  bob.send(JSON.stringify({ type: "subscribe-workspace" }));
  outsider.send(JSON.stringify({ type: "subscribe-workspace" }));
  await Promise.all([bobReady, outsiderReady]);
  const incoming = matchingMessage(bob, (event) => event.type === "typing");
  const quiet = expectNoMessage(outsider);
  alice.send("null");
  alice.send("[]");
  alice.send(
    JSON.stringify({
      type: "typing",
      channelId: "general",
      active: true,
      name: "Forged",
      text: "Private draft",
    }),
  );
  assert.deepEqual(await incoming, {
    type: "typing",
    channelId: "general",
    users: [{ id: "test-Typing Alice", name: "Typing Alice" }],
  });
  await quiet;
  const stopped = matchingMessage(bob, (event) => event.type === "typing");
  alice.send(
    JSON.stringify({ type: "typing", channelId: "general", active: false }),
  );
  assert.deepEqual((await stopped).users, []);
  const denied = expectNoMessage(outsider);
  alice.send(
    JSON.stringify({ type: "typing", channelId: "random", active: true }),
  );
  await denied;
});

test("DM typing requires friendship and stops when the typing socket disconnects", async () => {
  const url = await startServer();
  const alice = await connect(url, "Typing A", [], [], ["test-Typing B"]);
  const bob = await connect(url, "Typing B", [], [], ["test-Typing A"]);
  const outsider = await connect(url, "Typing stranger", [], [], []);
  const incoming = matchingMessage(bob, (event) => event.type === "typing");
  alice.send(
    JSON.stringify({ type: "typing", userId: "test-Typing B", active: true }),
  );
  assert.deepEqual(await incoming, {
    type: "typing",
    userId: "test-Typing A",
    users: [{ id: "test-Typing A", name: "Typing A" }],
  });
  const stopped = matchingMessage(bob, (event) => event.type === "typing");
  alice.close();
  assert.deepEqual((await stopped).users, []);
  const quiet = expectNoMessage(bob);
  outsider.send(
    JSON.stringify({ type: "typing", userId: "test-Typing B", active: true }),
  );
  await quiet;
});

test("voice claims serialize per account, remove SFU media before replacement and reject stale cleanup", async () => {
  const events = [];
  const sessions = createVoiceSessions({
    removeGroupMedia: async (userId) => {
      events.push(`remove:${userId}`);
    },
    onReplace: (userId, session) =>
      events.push(`replace:${userId}:${session.id}`),
  });
  await Promise.all([
    sessions.claim("a", { id: "first", roomId: "one", kind: "direct" }),
    sessions.claim("a", { id: "second", roomId: "two", kind: "group" }),
  ]);
  assert.deepEqual(events, ["remove:a", "remove:a", "replace:a:first"]);
  sessions.release("a", "first");
  assert.equal(sessions.confirm("a", "second"), true);
  sessions.suspend("a", "second");
  assert.equal(
    sessions.confirm("a", "second"),
    true,
    "presence reconnect retains ownership",
  );
  sessions.release("a", "second");
  assert.equal(sessions.confirm("a", "second"), false);
});

test("failed media removal preserves ownership, and an obsolete pending join cannot take over", async () => {
  let fail = false,
    valid = true;
  const replaced = [];
  const sessions = createVoiceSessions({
    removeGroupMedia: async () => {
      if (fail) throw new Error("SFU offline");
      valid = false;
    },
    onReplace: (_userId, session) => replaced.push(session.id),
  });
  await sessions.claim("a", { id: "original", roomId: "one", kind: "direct" });
  fail = true;
  await assert.rejects(
    sessions.claim("a", { id: "failed", roomId: "two", kind: "group" }),
  );
  assert.equal(sessions.confirm("a", "original"), true);
  fail = false;
  valid = true;
  assert.equal(
    await sessions.claim(
      "a",
      { id: "obsolete", roomId: "two", kind: "direct" },
      () => valid,
    ),
    false,
  );
  assert.deepEqual(replaced, []);
  sessions.release("a", "original");
});

test("automatic native reconnect resumes its own disconnected session and reclaims a temporary replacement", async () => {
  const sessions = createVoiceSessions({
    removeGroupMedia: async () => {},
    onReplace() {},
  });
  const oldSocket = { readyState: 1 };
  await sessions.claim("a", {
    id: "old",
    roomId: "one",
    kind: "direct",
    socket: oldSocket,
  });
  assert.equal(
    await sessions.claim("a", {
      id: "old",
      roomId: "one",
      kind: "direct",
    }),
    false,
    "an explicit join cannot duplicate a live session ID",
  );
  oldSocket.readyState = 3;
  sessions.suspend("a", "old");
  assert.equal(
    await sessions.claim("a", {
      id: "old",
      roomId: "one",
      kind: "direct",
      reconnecting: true,
    }),
    true,
  );
  await sessions.claim("a", { id: "new", roomId: "two", kind: "group" });
  assert.equal(
    await sessions.claim("a", {
      id: "old",
      roomId: "one",
      kind: "direct",
      reconnecting: true,
    }),
    true,
  );
  sessions.release("a", "old");
});

test("one account's new direct channel replaces its call in another server without affecting its peer", async () => {
  const removed = [];
  const url = await startServer({
    removeGroupMedia: async (userId) => removed.push(userId),
  });
  const first = await connect(url, "Ada", ["lounge"], ["server-1"]);
  let joined = nextMessage(first);
  first.send(
    JSON.stringify({ type: "join", roomId: "lounge", sessionId: "old" }),
  );
  await joined;
  const peer = await connect(url, "Grace");
  joined = nextMessage(peer);
  peer.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await joined;
  const second = await connect(url, "Ada", ["other-room"], ["server-2"]);
  const closed = once(first, "close"),
    left = nextMessage(peer);
  joined = nextMessage(second);
  second.send(
    JSON.stringify({ type: "join", roomId: "other-room", sessionId: "new" }),
  );
  assert.equal((await joined).type, "joined");
  assert.equal((await left).type, "peer-left");
  assert.equal((await closed)[0], 4000);
  assert.equal(peer.readyState, WebSocket.OPEN);
  assert.deepEqual(removed, ["test-Ada", "test-Grace", "test-Ada"]);
});

test("group admission is internal-only, replaces direct voice and survives stale direct socket cleanup", async () => {
  const url = await startServer();
  const first = await connect(url, "Ada");
  const joined = nextMessage(first);
  first.send(
    JSON.stringify({ type: "join", roomId: "lounge", sessionId: "direct" }),
  );
  await joined;
  const endpoint = `${url.replace("ws://", "http://")}/internal/claim-voice`;
  const body = JSON.stringify({
    userId: "test-Ada",
    roomId: "group-room",
    sessionId: "group",
  });
  assert.equal((await fetch(endpoint, { method: "POST", body })).status, 401);
  const closed = once(first, "close");
  assert.equal(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${authSecret}` },
        body,
      })
    ).status,
    204,
  );
  await closed;
  const presence = await connect(url, "Ada");
  const observer = await connect(url, "Observer");
  const initial = nextMessage(observer);
  observer.send(
    JSON.stringify({ type: "subscribe-presence", roomIds: ["group-room"] }),
  );
  await initial;
  const update = nextMessage(observer);
  presence.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      sessionId: "group",
      present: true,
    }),
  );
  assert.equal((await update).participants.length, 1);
  const quiet = expectNoMessage(observer);
  presence.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      sessionId: "direct",
      present: true,
    }),
  );
  await quiet;
});

test("native admission waits for group-media removal and notifies only the replaced session", async () => {
  let finishRemoval,
    calls = 0;
  const url = await startServer({
    removeGroupMedia: async () => {
      if (++calls === 2)
        await new Promise((resolve) => {
          finishRemoval = resolve;
        });
    },
  });
  const workspace = await connect(url, "Ada");
  const initial = matchingMessage(
    workspace,
    (message) => message.type === "presence" && message.roomId === "group-room",
  );
  workspace.send(JSON.stringify({ type: "subscribe-workspace" }));
  await initial;
  const claim = await fetch(
    `${url.replace("ws://", "http://")}/internal/claim-voice`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${authSecret}` },
      body: JSON.stringify({
        userId: "test-Ada",
        roomId: "group-room",
        sessionId: "old-group",
      }),
    },
  );
  assert.equal(claim.status, 204);
  const direct = await connect(url, "Ada");
  const replaced = matchingMessage(
    workspace,
    (message) => message.type === "voice-replaced",
  );
  const quiet = expectNoMessage(direct);
  direct.send(
    JSON.stringify({
      type: "join",
      roomId: "lounge",
      sessionId: "new-direct",
      reconnecting: true,
    }),
  );
  await quiet;
  assert.equal(typeof finishRemoval, "function");
  const joined = nextMessage(direct);
  finishRemoval();
  assert.equal((await joined).type, "joined");
  assert.deepEqual(await replaced, {
    type: "voice-replaced",
    sessionId: "old-group",
  });
});

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    if (resource instanceof WebSocket) resource.close();
    else await new Promise((resolve) => resource.close(resolve));
  }
});

async function startServer(options) {
  const server = createSignalingServer({
    port: 0,
    authSecret,
    internalSecret: authSecret,
    removeGroupMedia: async () => {},
    ...options,
  });
  resources.push(server);
  await once(server, "listening");
  const address = server.address();
  return `ws://127.0.0.1:${address.port}`;
}

async function connect(
  url,
  name = "Test user",
  channelIds = permittedChannelIds,
  serverIds = ["server-1"],
  friendIds = [],
  initialStatus = "online",
) {
  const token = createSignalingToken(
    { id: `test-${name}`, name, channelIds, serverIds, friendIds },
    authSecret,
  );
  const socket = new WebSocket(`${url}?token=${token}&status=${initialStatus}`);
  resources.unshift(socket);
  await once(socket, "open");
  return socket;
}

test("a returning group connection reclaims ownership and preserves its own SFU identity", async () => {
  const removed = [];
  const url = await startServer({
    removeGroupMedia: async (id, keep) => removed.push([id, keep]),
  });
  const temporary = await connect(url, "Ada");
  const joined = nextMessage(temporary);
  temporary.send(
    JSON.stringify({ type: "join", roomId: "lounge", sessionId: "temporary" }),
  );
  await joined;
  const closed = once(temporary, "close");
  const returning = await connect(url, "Ada");
  const observer = await connect(url, "Observer");
  const initial = nextMessage(observer);
  observer.send(
    JSON.stringify({ type: "subscribe-presence", roomIds: ["group-room"] }),
  );
  await initial;
  const present = nextMessage(observer);
  returning.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      sessionId: "original",
      present: true,
      reconnecting: true,
      muted: true,
    }),
  );
  const snapshot = await present;
  assert.equal(snapshot.participants[0].userId, "test-Ada");
  assert.equal(snapshot.participants[0].muted, true);
  await closed;
  assert.deepEqual(removed.at(-1), ["test-Ada", "original"]);
});

test("authenticated internal events reach only the selected user", async () => {
  const url = await startServer();
  const recipient = await connect(url, "Grace");
  const outsider = await connect(url, "Ada");
  const received = nextMessage(recipient);
  const stayedQuiet = expectNoMessage(outsider);
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/user-event`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "test-Grace",
        event: { type: "friendship-changed" },
      }),
    },
  );
  assert.equal(response.status, 204);
  assert.deepEqual(await received, { type: "friendship-changed" });
  await stayedQuiet;
});

test("profile name updates replace connected identities and survive subsequent voice presence packets", async () => {
  const url = await startServer();
  const actor = await connect(url, "Grace"),
    observer = await connect(url, "Ada");
  const initial = nextMessage(observer);
  observer.send(
    JSON.stringify({ type: "subscribe-presence", roomIds: ["lounge"] }),
  );
  await initial;
  const occupied = matchingMessage(
    observer,
    (event) => event.type === "presence" && event.participants.length === 1,
  );
  const joined = matchingMessage(actor, (event) => event.type === "joined");
  actor.send(
    JSON.stringify({
      type: "join",
      roomId: "lounge",
      participantName: "Grace",
    }),
  );
  await Promise.all([occupied, joined]);
  const changed = matchingMessage(
    observer,
    (event) =>
      event.type === "presence" &&
      event.participants[0]?.name === "Updated Grace",
  );
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/user-event`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId: "test-Grace",
        event: {
          type: "profile-updated",
          userId: "test-Grace",
          name: "Updated Grace",
        },
      }),
    },
  );
  assert.equal(response.status, 204);
  await changed;
  const subsequent = matchingMessage(
    observer,
    (event) => event.type === "presence" && event.participants[0]?.soundboard,
  );
  actor.send(
    JSON.stringify({ type: "media-state", soundboard: true, speaking: true }),
  );
  assert.equal((await subsequent).participants[0].name, "Updated Grace");
});

test("automatic Away is distinguished from manual Away and synchronizes across account sockets", async () => {
  const url = await startServer();
  const first = await connect(url, "Grace"),
    second = await connect(url, "Grace");
  const automatic = matchingMessage(
    second,
    (event) => event.type === "user-status",
  );
  first.send(
    JSON.stringify({
      type: "set-user-status",
      status: "away",
      automatic: true,
    }),
  );
  assert.deepEqual(await automatic, {
    type: "user-status",
    status: "away",
    automatic: true,
  });
  const snapshot = matchingMessage(
    second,
    (event) => event.type === "user-status",
  );
  second.send(JSON.stringify({ type: "get-user-status" }));
  assert.equal((await snapshot).automatic, true);
  const manual = matchingMessage(
    first,
    (event) => event.type === "user-status" && !event.automatic,
  );
  second.send(JSON.stringify({ type: "set-user-status", status: "away" }));
  assert.deepEqual(await manual, {
    type: "user-status",
    status: "away",
    automatic: false,
  });
});

test("call invitations require an accepted friend in the signaling token", async () => {
  const url = await startServer();
  const ada = await connect(
    url,
    "Ada",
    permittedChannelIds,
    ["server-1"],
    ["test-Grace"],
  );
  const grace = await connect(
    url,
    "Grace",
    permittedChannelIds,
    ["server-1"],
    ["test-Ada"],
  );
  const invitation = nextMessage(grace);
  ada.send(JSON.stringify({ type: "call-invite", targetUserId: "test-Grace" }));
  assert.deepEqual(await invitation, {
    type: "call-invite",
    fromUserId: "test-Ada",
    fromName: "Ada",
    roomId: "friend:test-Ada:test-Grace",
  });

  // The receiver is only ringing and has never joined the voice room.
  const cancellation = nextMessage(grace);
  ada.send(
    JSON.stringify({
      type: "call-cancel",
      targetUserId: "test-Grace",
      fromUserId: "forged",
      roomId: "forged",
    }),
  );
  assert.deepEqual(await cancellation, {
    type: "call-cancel",
    fromUserId: "test-Ada",
    fromName: "Ada",
    roomId: "friend:test-Ada:test-Grace",
  });

  const forbidden = nextMessage(grace);
  grace.send(JSON.stringify({ type: "call-invite", targetUserId: "stranger" }));
  assert.deepEqual(await forbidden, {
    type: "forbidden",
    channelId: "stranger",
  });
  const forbiddenCancel = nextMessage(grace);
  grace.send(JSON.stringify({ type: "call-cancel", targetUserId: "stranger" }));
  assert.equal((await forbiddenCancel).type, "forbidden");
});

test("legacy server presence authorizes subscriptions and broadcasts connections and departures", async () => {
  const url = await startServer();
  const first = await connect(url, "Ada");
  const presence = nextMessage(first);
  first.send(
    JSON.stringify({ type: "subscribe-online", serverId: "server-1" }),
  );
  assert.deepEqual(await presence, {
    type: "online-presence",
    serverId: "server-1",
    userIds: ["test-Ada"],
    statuses: { "test-Ada": "online" },
  });
  const connected = nextMessage(first);
  const second = await connect(url, "Grace");
  assert.deepEqual(await connected, {
    type: "online-presence",
    serverId: "server-1",
    userIds: ["test-Ada", "test-Grace"],
    statuses: { "test-Ada": "online", "test-Grace": "online" },
  });
  const forbidden = nextMessage(second);
  second.send(
    JSON.stringify({ type: "subscribe-online", serverId: "private" }),
  );
  assert.deepEqual(await forbidden, {
    type: "forbidden",
    channelId: "private",
  });
  const disconnected = nextMessage(first);
  second.close();
  assert.deepEqual(await disconnected, {
    type: "online-presence",
    serverId: "server-1",
    userIds: ["test-Ada"],
    statuses: { "test-Ada": "online" },
  });
});

test("status changes are self-only, synchronize sockets, and invisible stays offline with multiple connections", async () => {
  const url = await startServer();
  const observer = await connect(url, "Ada");
  const grace = await connect(url, "Grace");
  const duplicate = await connect(url, "Grace");
  let update = nextMessage(observer);
  observer.send(
    JSON.stringify({
      type: "subscribe-user-presence",
      userIds: ["test-Ada", "test-Grace"],
    }),
  );
  await update;
  update = nextMessage(observer);
  const acknowledgements = [nextMessage(grace), nextMessage(duplicate)];
  grace.send(
    JSON.stringify({
      type: "set-user-status",
      status: "invisible",
      userId: "test-Ada",
    }),
  );
  const hidden = await update;
  assert.deepEqual(
    hidden.userIds,
    ["test-Ada"],
    "a forged userId must not change another user's status",
  );
  assert.deepEqual(hidden.statuses, { "test-Ada": "online" });
  for (const ack of await Promise.all(acknowledgements))
    assert.deepEqual(ack, {
      type: "user-status",
      status: "invisible",
      automatic: false,
    });
  update = nextMessage(observer);
  await connect(url, "Grace");
  assert.deepEqual(
    (await update).userIds,
    ["test-Ada"],
    "another socket must not reveal an invisible account",
  );
  for (const status of ["away", "dnd", "online"]) {
    update = nextMessage(observer);
    grace.send(JSON.stringify({ type: "set-user-status", status }));
    const visible = await update;
    assert.ok(visible.userIds.includes("test-Grace"));
    assert.equal(visible.statuses["test-Grace"], status);
  }
  const unchanged = nextMessage(grace);
  grace.send(JSON.stringify({ type: "set-user-status", status: "invalid" }));
  grace.send(JSON.stringify({ type: "get-user-status" }));
  assert.deepEqual(await unchanged, {
    type: "user-status",
    status: "online",
    automatic: false,
  });
});

test("saved invisible status is applied before the first online broadcast", async () => {
  const url = await startServer();
  const observer = await connect(url, "Ada");
  let update = nextMessage(observer);
  observer.send(
    JSON.stringify({
      type: "subscribe-user-presence",
      userIds: ["test-Ada", "test-Hidden"],
    }),
  );
  await update;
  update = nextMessage(observer);
  await connect(
    url,
    "Hidden",
    permittedChannelIds,
    ["server-1"],
    [],
    "invisible",
  );
  assert.deepEqual((await update).userIds, ["test-Ada"]);
});

test("user presence updates friends and shared-server members across all views without leaking unrelated users", async () => {
  const url = await startServer();
  const grace = await connect(url, "Grace", permittedChannelIds, [
    "server-1",
    "server-2",
  ]);
  const friend = await connect(url, "Friend", [], [], ["test-Grace"]);
  const member = await connect(url, "Member", permittedChannelIds, [
    "server-2",
  ]);
  const outsider = await connect(url, "Outsider", [], ["private"]);
  const presence = (socket, predicate = () => true) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive);
        reject(new Error("User presence update timed out"));
      }, 2000);
      function receive(raw) {
        const message = JSON.parse(raw.toString());
        if (message.type !== "user-presence" || !predicate(message)) return;
        clearTimeout(timer);
        socket.off("message", receive);
        resolve(message);
      }
      socket.on("message", receive);
    });
  for (const viewer of [friend, member, outsider]) {
    const snapshot = presence(viewer);
    viewer.send(
      JSON.stringify({
        type: "subscribe-user-presence",
        userIds: ["test-Grace"],
      }),
    );
    const initial = await snapshot;
    assert.equal(initial.userIds.includes("test-Grace"), viewer !== outsider);
  }
  for (const status of ["away", "dnd", "invisible", "online"]) {
    const updates = [friend, member].map((viewer) =>
      presence(viewer, (message) =>
        status === "invisible"
          ? !message.userIds.includes("test-Grace")
          : message.statuses["test-Grace"] === status,
      ),
    );
    const privateSnapshot = presence(outsider);
    grace.send(JSON.stringify({ type: "set-user-status", status }));
    for (const update of await Promise.all(updates))
      assert.equal("test-Outsider" in update.statuses, false);
    assert.equal((await privateSnapshot).userIds.includes("test-Grace"), false);
  }
  const disconnected = presence(
    friend,
    (message) => !message.userIds.includes("test-Grace"),
  );
  grace.close();
  await disconnected;
});

test("an authenticated internal command disconnects a user immediately", async () => {
  const url = await startServer();
  const socket = await connect(url, "Ada");
  const accessChanged = nextMessage(socket);
  const closed = once(socket, "close");
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/disconnect-user`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "test-Ada" }),
    },
  );
  assert.equal(response.status, 204);
  assert.deepEqual(await accessChanged, { type: "access-changed" });
  const [code] = await closed;
  assert.equal(code, 4003);
});

test("an unauthenticated disconnect command cannot remove a user", async () => {
  const url = await startServer();
  const socket = await connect(url, "Ada");
  const stayedConnected = expectNoMessage(socket);
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/disconnect-user`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "test-Ada" }),
    },
  );
  assert.equal(response.status, 401);
  await stayedConnected;
  assert.equal(socket.readyState, WebSocket.OPEN);
});

test("server removal delivers a specific kick notice before closing account sockets", async () => {
  const url = await startServer(),
    socket = await connect(url, "Ada");
  const accessChanged = nextMessage(socket),
    closed = once(socket, "close");
  const removal = {
    reason: "server-kicked",
    serverId: "server-1",
    serverName: "Friends server",
  };
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/disconnect-user`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "test-Ada", ...removal }),
    },
  );
  assert.equal(response.status, 204);
  assert.deepEqual(await accessChanged, { type: "access-changed", ...removal });
  assert.equal((await closed)[0], 4003);
});

test("connections without a valid authentication token are rejected", async () => {
  const url = await startServer();
  const socket = new WebSocket(url);
  socket.on("error", () => {});
  const [request, response] = await once(socket, "unexpected-response");
  assert.equal(response.statusCode, 401);
  request.destroy();
  response.destroy();
});

test("authenticated users cannot subscribe to unauthorized channels", async () => {
  const url = await startServer();
  const socket = await connect(url, "Limited user", ["general"]);
  const forbidden = nextMessage(socket);
  socket.send(JSON.stringify({ type: "subscribe-text", channelId: "private" }));
  assert.deepEqual(await forbidden, {
    type: "forbidden",
    channelId: "private",
  });
});

test("reaction invalidations authenticate and reach only authorized channel subscribers", async () => {
  const url = await startServer();
  const viewer = await connect(url, "Reaction viewer", ["general"]);
  const outsider = await connect(url, "Reaction outsider", ["random"]);
  const subscribed = nextMessage(viewer),
    otherSubscribed = nextMessage(outsider);
  viewer.send(JSON.stringify({ type: "subscribe-workspace" }));
  outsider.send(JSON.stringify({ type: "subscribe-workspace" }));
  await Promise.all([subscribed, otherSubscribed]);
  const endpoint = `${url.replace("ws://", "http://")}/internal/message-reactions-changed`;
  const body = JSON.stringify({
    channelId: "general",
    messageId: "reacted-message",
  });
  assert.equal((await fetch(endpoint, { method: "POST", body })).status, 401);
  const incoming = matchingMessage(
    viewer,
    (event) => event.type === "message-reactions-changed",
  );
  const quiet = expectNoMessage(outsider);
  assert.equal(
    (
      await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authSecret}`,
          "Content-Type": "application/json",
        },
        body,
      })
    ).status,
    204,
  );
  assert.deepEqual(await incoming, {
    type: "message-reactions-changed",
    messageId: "reacted-message",
  });
  await quiet;
});

function nextMessage(socket) {
  return once(socket, "message").then(([data]) => JSON.parse(data.toString()));
}

function matchingMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", receive);
      reject(new Error("Expected signaling activity did not arrive"));
    }, 1500);
    function receive(raw) {
      const message = JSON.parse(raw.toString());
      if (predicate(message)) {
        clearTimeout(timer);
        socket.off("message", receive);
        resolve(message);
      }
    }
    socket.on("message", receive);
  });
}

test("workspace subscriptions deliver only authorized message metadata across channels", async () => {
  const url = await startServer();
  const viewer = await connect(url, "Viewer", ["general", "random"]);
  const outsider = await connect(
    url,
    "Outsider",
    ["private"],
    ["other-server"],
  );
  const ready = matchingMessage(
    viewer,
    (message) => message.type === "presence" && message.roomId === "random",
  );
  viewer.send(
    JSON.stringify({ type: "subscribe-workspace", channelIds: ["private"] }),
  );
  await ready;
  const outsiderReady = nextMessage(outsider);
  outsider.send(JSON.stringify({ type: "subscribe-workspace" }));
  await outsiderReady;
  const incoming = matchingMessage(
    viewer,
    (message) => message.type === "channel-activity",
  );
  const quiet = expectNoMessage(outsider);
  await fetch(`${url.replace("ws://", "http://")}/internal/text-message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channelId: "general",
      message: {
        id: "m1",
        text: "Message body",
        author: "Sender",
        authorId: "sender",
        createdAt: "2026-11-03T12:00:00Z",
      },
    }),
  });
  assert.deepEqual(await incoming, {
    type: "channel-activity",
    channelId: "general",
    messageId: "m1",
    authorId: "sender",
    createdAt: "2026-11-03T12:00:00Z",
  });
  await quiet;
  const viewerQuiet = expectNoMessage(viewer);
  await fetch(`${url.replace("ws://", "http://")}/internal/text-message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channelId: "private",
      message: {
        id: "m2",
        text: "Private",
        author: "Sender",
        authorId: "sender",
        createdAt: "2026-11-03T12:00:00Z",
      },
    }),
  });
  await viewerQuiet;
});

test("workspace voice presence covers initial occupants and live changes across all authorized rooms", async () => {
  const url = await startServer();
  const speaker = await connect(url, "Speaker", ["lounge", "group-room"]);
  const joined = nextMessage(speaker);
  speaker.send(
    JSON.stringify({
      type: "join",
      roomId: "lounge",
      participantName: "Speaker",
    }),
  );
  await joined;
  const viewer = await connect(url, "Viewer", ["lounge", "group-room"]);
  const initial = matchingMessage(
    viewer,
    (message) => message.type === "presence" && message.roomId === "lounge",
  );
  const ready = matchingMessage(
    viewer,
    (message) => message.type === "presence" && message.roomId === "group-room",
  );
  viewer.send(JSON.stringify({ type: "subscribe-workspace" }));
  assert.equal((await initial).participants[0].name, "Speaker");
  await ready;
  const newcomer = await connect(url, "Newcomer", ["lounge"]);
  const joinedLive = matchingMessage(
    viewer,
    (message) =>
      message.type === "presence" &&
      message.roomId === "lounge" &&
      message.participants.length === 2,
  );
  newcomer.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.deepEqual(
    (await joinedLive).participants.map((person) => person.name).sort(),
    ["Newcomer", "Speaker"],
  );
  const leftLive = matchingMessage(
    viewer,
    (message) =>
      message.type === "presence" &&
      message.roomId === "lounge" &&
      message.participants.length === 1,
  );
  newcomer.close();
  assert.equal((await leftLive).participants[0].name, "Speaker");
  const group = matchingMessage(
    viewer,
    (message) =>
      message.type === "presence" &&
      message.roomId === "group-room" &&
      message.participants.length === 1,
  );
  speaker.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      present: true,
      participantName: "Speaker",
    }),
  );
  assert.equal((await group).participants[0].userId, "test-Speaker");
  const left = matchingMessage(
    viewer,
    (message) =>
      message.type === "presence" &&
      message.roomId === "group-room" &&
      message.participants.length === 0,
  );
  speaker.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      present: false,
    }),
  );
  await left;
});

test("authenticated voice moves reach only the target's workspace for native and group calls", async () => {
  const url = await startServer();
  for (const [name, roomId, type] of [
    ["Native mover", "interview", "voice_direct"],
    ["Group mover", "group-room", "voice_group"],
  ]) {
    const target = await connect(url, name, [roomId, "lounge"]);
    const ready = matchingMessage(
      target,
      (message) => message.type === "presence" && message.roomId === roomId,
    );
    target.send(JSON.stringify({ type: "subscribe-workspace" }));
    await ready;
    const present = matchingMessage(
      target,
      (message) =>
        message.type === "presence" &&
        message.roomId === roomId &&
        message.participants.length === 1,
    );
    target.send(
      JSON.stringify(
        type === "voice_direct"
          ? { type: "join", roomId }
          : { type: "set-group-presence", roomId, present: true },
      ),
    );
    await present;
    const body = {
      userId: `test-${name}`,
      roomId,
      channel: {
        id: "lounge",
        type: "voice_direct",
        name: "Lounge",
        serverId: "server-1",
      },
    };
    const endpoint = `${url.replace("ws://", "http://")}/internal/move-voice`;
    assert.equal(
      (await fetch(endpoint, { method: "POST", body: JSON.stringify(body) }))
        .status,
      401,
    );
    const event = matchingMessage(
      target,
      (message) => message.type === "voice-move",
    );
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${authSecret}` },
          body: JSON.stringify(body),
        })
      ).status,
      204,
    );
    assert.deepEqual(await event, {
      type: "voice-move",
      roomId,
      channel: body.channel,
    });
    assert.equal(
      (
        await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${authSecret}` },
          body: JSON.stringify({ ...body, roomId: "other-room" }),
        })
      ).status,
      404,
    );
  }
});

test("voice moves reject full native destinations and never accept client-published move commands", async () => {
  const url = await startServer();
  for (const name of ["Occupant A", "Occupant B"]) {
    const occupant = await connect(url, name);
    const joined = matchingMessage(
      occupant,
      (message) => message.type === "joined",
    );
    occupant.send(JSON.stringify({ type: "join", roomId: "lounge" }));
    await joined;
  }
  const target = await connect(url, "Moving", ["lounge", "group-room"]);
  const ready = matchingMessage(
    target,
    (message) => message.type === "presence" && message.roomId === "group-room",
  );
  target.send(JSON.stringify({ type: "subscribe-workspace" }));
  await ready;
  const present = matchingMessage(
    target,
    (message) =>
      message.type === "presence" &&
      message.roomId === "group-room" &&
      message.participants.length === 1,
  );
  target.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      present: true,
    }),
  );
  await present;
  const event = {
    type: "voice-move",
    roomId: "group-room",
    channel: {
      id: "lounge",
      name: "Lounge",
      type: "voice_direct",
      serverId: "server-1",
    },
  };
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/move-voice`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${authSecret}` },
      body: JSON.stringify({ ...event, userId: "test-Moving" }),
    },
  );
  assert.equal(response.status, 409);
  const quiet = expectNoMessage(target);
  target.send(JSON.stringify(event));
  await quiet;
});

test("pending voice is visible before media joins, uses signed identity and becomes a single connected occupant", async () => {
  const url = await startServer();
  const viewer = await connect(url, "Pending viewer");
  const ready = matchingMessage(
    viewer,
    (message) => message.type === "presence" && message.roomId === "group-room",
  );
  viewer.send(JSON.stringify({ type: "subscribe-workspace" }));
  await ready;
  const pending = await connect(url, "Joining user");
  for (const roomId of ["lounge", "group-room"]) {
    const appeared = matchingMessage(
      viewer,
      (message) =>
        message.type === "presence" &&
        message.roomId === roomId &&
        message.participants[0]?.connecting,
    );
    pending.send(
      JSON.stringify({
        type: "set-voice-pending",
        roomId,
        present: true,
        userId: "spoof",
        name: "spoof",
      }),
    );
    const people = (await appeared).participants;
    assert.equal(people.length, 1);
    assert.equal(people[0].userId, "test-Joining user");
    assert.equal(people[0].name, "Joining user");
    const connected = matchingMessage(
      viewer,
      (message) =>
        message.type === "presence" &&
        message.roomId === roomId &&
        message.participants.length === 1 &&
        !message.participants[0].connecting,
    );
    if (roomId === "lounge") {
      const call = await connect(url, "Joining user");
      call.send(JSON.stringify({ type: "join", roomId }));
      await connected;
      const left = matchingMessage(
        viewer,
        (message) =>
          message.type === "presence" &&
          message.roomId === roomId &&
          !message.participants.length,
      );
      call.close();
      await left;
    } else {
      pending.send(
        JSON.stringify({ type: "set-group-presence", roomId, present: true }),
      );
      await connected;
    }
  }
});

test("pending voice cancellation, disconnect and expiry clear placeholders; unrelated channels are forbidden", async () => {
  const url = await startServer({ pendingVoiceTimeoutMs: 500 });
  const viewer = await connect(url, "Observer", ["group-room"]);
  const ready = matchingMessage(
    viewer,
    (message) => message.type === "presence",
  );
  viewer.send(JSON.stringify({ type: "subscribe-workspace" }));
  await ready;
  const target = await connect(url, "Pending", ["group-room"]);
  const forbidden = matchingMessage(
    target,
    (message) => message.type === "forbidden",
  );
  target.send(
    JSON.stringify({
      type: "set-voice-pending",
      roomId: "private",
      present: true,
    }),
  );
  await forbidden;
  for (const action of ["cancel", "expiry", "disconnect"]) {
    const appeared = matchingMessage(
      viewer,
      (message) =>
        message.type === "presence" && message.participants[0]?.connecting,
    );
    target.send(
      JSON.stringify({
        type: "set-voice-pending",
        roomId: "group-room",
        present: true,
      }),
    );
    await appeared;
    const cleared = matchingMessage(
      viewer,
      (message) => message.type === "presence" && !message.participants.length,
    );
    if (action === "cancel")
      target.send(
        JSON.stringify({
          type: "set-voice-pending",
          roomId: "group-room",
          present: false,
        }),
      );
    if (action === "disconnect") target.close();
    await cleared;
  }
});

function expectNoMessage(socket, duration = 75) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      clearTimeout(timer);
      reject(new Error(`Unexpected message: ${data.toString()}`));
    };
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, duration);
    socket.once("message", onMessage);
  });
}

test("peers join, relay messages, and announce departure", async () => {
  const url = await startServer();
  const first = await connect(url, "First");
  const second = await connect(url, "Second");

  const firstJoined = nextMessage(first);
  first.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.deepEqual(await firstJoined, { type: "joined", initiator: true });

  const secondJoined = nextMessage(second);
  const peerJoined = nextMessage(first);
  second.send(
    JSON.stringify({ type: "join", roomId: "lounge", userId: "spoofed" }),
  );
  assert.deepEqual(await secondJoined, { type: "joined", initiator: false });
  assert.deepEqual(await peerJoined, {
    type: "peer-joined",
    userId: "test-Second",
  });

  const relayedChat = nextMessage(second);
  first.send(JSON.stringify({ type: "chat", text: "hello" }));
  assert.deepEqual(await relayedChat, { type: "chat", text: "hello" });

  const peerLeft = nextMessage(first);
  second.close();
  assert.deepEqual(await peerLeft, {
    type: "peer-left",
    userId: "test-Second",
  });
});

test("a direct-room peer remains joined and accepts a replacement peer", async () => {
  const url = await startServer();
  const remaining = await connect(url, "Remaining");
  const leaving = await connect(url, "Leaving");

  const remainingJoined = nextMessage(remaining);
  remaining.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await remainingJoined;
  const leavingJoined = nextMessage(leaving);
  const firstPeerJoined = nextMessage(remaining);
  leaving.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await leavingJoined;
  await firstPeerJoined;

  const peerLeft = nextMessage(remaining);
  leaving.close();
  assert.deepEqual(await peerLeft, {
    type: "peer-left",
    userId: "test-Leaving",
  });

  const replacement = await connect(url, "Replacement");
  const replacementJoined = nextMessage(replacement);
  const replacementAnnounced = nextMessage(remaining);
  replacement.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.deepEqual(await replacementJoined, {
    type: "joined",
    initiator: false,
  });
  assert.deepEqual(await replacementAnnounced, {
    type: "peer-joined",
    userId: "test-Replacement",
  });

  const relayed = nextMessage(remaining);
  replacement.send(JSON.stringify({ type: "candidate", candidate: "fresh" }));
  assert.deepEqual(await relayed, { type: "candidate", candidate: "fresh" });
});

test("channel deletion authenticates, revokes stale access and leaves other rooms connected", async () => {
  const url = await startServer();
  const target = await connect(url, "Target");
  const other = await connect(url, "Other");
  const observer = await connect(url, "Observer");
  for (const [socket, roomId] of [
    [target, "lounge"],
    [other, "other-room"],
  ]) {
    const joined = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join", roomId }));
    await joined;
  }
  const request = (secret) =>
    fetch(`${url.replace("ws://", "http://")}/internal/channel-deleted`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ serverId: "server-1", channelId: "lounge" }),
    });
  assert.equal((await request("wrong")).status, 401);
  assert.equal(target.readyState, WebSocket.OPEN);
  const closed = once(target, "close");
  const event = nextMessage(observer);
  assert.equal((await request(authSecret)).status, 204);
  assert.equal((await event).type, "channel-deleted");
  await closed;
  assert.equal(other.readyState, WebSocket.OPEN);
  const forbidden = nextMessage(observer);
  observer.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.equal((await forbidden).type, "forbidden");
  const stale = await connect(url, "Stale");
  const denied = nextMessage(stale);
  stale.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.equal((await denied).type, "forbidden");
});

test("internal voice kick closes only the selected room participant", async () => {
  const url = await startServer();
  const owner = await connect(url, "Owner");
  const guest = await connect(url, "Guest");
  const ownerJoined = nextMessage(owner);
  owner.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await ownerJoined;
  const guestJoined = nextMessage(guest);
  const announced = nextMessage(owner);
  guest.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await guestJoined;
  await announced;

  const kicked = nextMessage(guest);
  const guestClosed = once(guest, "close");
  const peerLeft = nextMessage(owner);
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/kick-voice`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: "test-Guest", roomId: "lounge" }),
    },
  );
  assert.equal(response.status, 204);
  assert.deepEqual(await kicked, { type: "voice-kicked" });
  await guestClosed;
  assert.deepEqual(await peerLeft, { type: "peer-left", userId: "test-Guest" });
  assert.equal(owner.readyState, WebSocket.OPEN);
});

test("reconnecting user replaces an old room socket without evicting the peer", async () => {
  const url = await startServer();
  const first = await connect(url, "Ada");
  const other = await connect(url, "Grace");
  const firstJoined = nextMessage(first);
  first.send(
    JSON.stringify({ type: "join", roomId: "lounge", sessionId: "resuming" }),
  );
  await firstJoined;
  const otherJoined = nextMessage(other);
  const announced = nextMessage(first);
  other.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await otherJoined;
  await announced;

  const replacement = await connect(url, "Ada");
  const replaced = once(first, "close");
  const replacementJoined = nextMessage(replacement);
  const replacementAnnounced = nextMessage(other);
  replacement.send(
    JSON.stringify({
      type: "join",
      roomId: "lounge",
      sessionId: "resuming",
      reconnecting: true,
    }),
  );
  assert.deepEqual(await replacementJoined, {
    type: "joined",
    initiator: false,
  });
  assert.deepEqual(await replacementAnnounced, {
    type: "peer-joined",
    userId: "test-Ada",
  });
  await replaced;
  assert.equal(other.readyState, WebSocket.OPEN);
});

test("room capacity is configurable and rejected peers never join", async () => {
  const url = await startServer({ maxPeers: 1 });
  const first = await connect(url, "First");
  const rejected = await connect(url, "Rejected");

  const firstJoined = nextMessage(first);
  first.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  await firstJoined;

  const roomFull = nextMessage(rejected);
  rejected.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.deepEqual(await roomFull, { type: "room-full" });

  const acceptedElsewhere = nextMessage(rejected);
  rejected.send(JSON.stringify({ type: "join", roomId: "interview" }));
  assert.deepEqual(await acceptedElsewhere, {
    type: "joined",
    initiator: true,
  });
});

test("messages are relayed only inside the sender's room", async () => {
  const url = await startServer({ maxPeers: 3 });
  const first = await connect(url, "First");
  const partner = await connect(url, "Partner");
  const outsider = await connect(url, "Outsider");

  for (const [socket, roomId] of [
    [first, "lounge"],
    [partner, "lounge"],
    [outsider, "other-room"],
  ]) {
    const joined = nextMessage(socket);
    const peerJoined = socket === partner ? nextMessage(first) : null;
    socket.send(JSON.stringify({ type: "join", roomId }));
    await joined;
    if (peerJoined) await peerJoined;
  }

  const partnerMessage = nextMessage(partner);
  const outsiderStayedQuiet = expectNoMessage(outsider);
  first.send(JSON.stringify({ type: "candidate", candidate: "candidate-1" }));
  assert.deepEqual(await partnerMessage, {
    type: "candidate",
    candidate: "candidate-1",
  });
  await outsiderStayedQuiet;
});

test("persisted text messages are delivered only to channel subscribers", async () => {
  const url = await startServer();
  const attacker = await connect(url);
  const recipient = await connect(url);
  const outsider = await connect(url);

  for (const [socket, channelId] of [
    [attacker, "general"],
    [recipient, "general"],
    [outsider, "random"],
  ]) {
    const subscribed = nextMessage(socket);
    socket.send(JSON.stringify({ type: "subscribe-text", channelId }));
    assert.deepEqual(await subscribed, {
      type: "text-subscribed",
      channelId,
    });
  }

  const rejectedPublish = nextMessage(attacker);
  const recipientStayedQuiet = expectNoMessage(recipient);
  attacker.send(
    JSON.stringify({
      type: "text-message",
      channelId: "general",
      message: { id: "forged", author: "Forged", text: "forged" },
    }),
  );
  assert.deepEqual(await rejectedPublish, {
    type: "forbidden-message-publish",
  });
  await recipientStayedQuiet;

  const delivered = nextMessage(recipient);
  const deliveredToOtherSubscriber = nextMessage(attacker);
  const outsiderStayedQuiet = expectNoMessage(outsider);
  const message = {
    id: "message-1",
    author: "Ada",
    text: "hello",
    createdAt: "2026-10-21T12:00:00.000Z",
  };
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/text-message`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channelId: "general", message }),
    },
  );
  assert.equal(response.status, 204);

  assert.deepEqual(await delivered, {
    type: "text-message",
    channelId: "general",
    message,
  });
  assert.deepEqual(await deliveredToOtherSubscriber, {
    type: "text-message",
    channelId: "general",
    message,
  });
  await outsiderStayedQuiet;
});

test("persisted edits reach text subscribers and invalidate authorized caches without unread activity", async () => {
  const url = await startServer();
  const reader = await connect(url, "Edit reader", ["general"]);
  const outsider = await connect(url, "Edit outsider", ["random"]);
  const observer = await connect(url, "Edit observer", ["general"]);
  const subscribed = nextMessage(reader);
  reader.send(JSON.stringify({ type: "subscribe-text", channelId: "general" }));
  await subscribed;
  observer.send(JSON.stringify({ type: "subscribe-workspace" }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const endpoint = `${url.replace("ws://", "http://")}/internal/message-edited`;
  const edit = {
    id: "message-1",
    text: "corrected",
    editedAt: "2026-11-04T12:00:00Z",
  };
  const post = (body, authorized = true) =>
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorized ? { Authorization: `Bearer ${authSecret}` } : {}),
      },
      body: JSON.stringify(body),
    });
  assert.equal((await post({ channelId: "general", edit }, false)).status, 401);
  assert.equal(
    (await post({ channelId: "general", edit: { ...edit, editedAt: "bad" } }))
      .status,
    400,
  );
  const incoming = nextMessage(reader),
    invalidated = nextMessage(observer),
    quiet = expectNoMessage(outsider);
  assert.equal((await post({ channelId: "general", edit })).status, 204);
  assert.deepEqual(await incoming, {
    type: "message-edited",
    channelId: "general",
    edit,
  });
  assert.deepEqual(await invalidated, {
    type: "channel-history-changed",
    channelId: "general",
  });
  await quiet;
});

test("persisted message deletions are delivered only to channel subscribers", async () => {
  const url = await startServer();
  const recipient = await connect(url);
  const outsider = await connect(url);

  for (const [socket, channelId] of [
    [recipient, "general"],
    [outsider, "random"],
  ]) {
    const subscribed = nextMessage(socket);
    socket.send(JSON.stringify({ type: "subscribe-text", channelId }));
    await subscribed;
  }

  const delivered = nextMessage(recipient);
  const outsiderStayedQuiet = expectNoMessage(outsider);
  const response = await fetch(
    `${url.replace("ws://", "http://")}/internal/message-deleted`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channelId: "general",
        messageId: "message-1",
        permanent: true,
      }),
    },
  );

  assert.equal(response.status, 204);
  assert.deepEqual(await delivered, {
    type: "message-deleted",
    channelId: "general",
    messageId: "message-1",
    permanent: true,
  });
  await outsiderStayedQuiet;
});

test("presence observers see occupants without joining the call", async () => {
  const url = await startServer();
  const observer = await connect(url);
  const caller = await connect(url, "Ada");

  const initiallyEmpty = nextMessage(observer);
  observer.send(
    JSON.stringify({ type: "subscribe-presence", roomIds: ["lounge"] }),
  );
  assert.deepEqual(await initiallyEmpty, {
    type: "presence",
    roomId: "lounge",
    participants: [],
  });

  const callerJoined = nextMessage(caller);
  const occupied = nextMessage(observer);
  caller.send(
    JSON.stringify({
      type: "join",
      roomId: "lounge",
      participantName: "Ada",
    }),
  );
  await callerJoined;
  assert.deepEqual(await occupied, {
    type: "presence",
    roomId: "lounge",
    participants: [
      {
        userId: "test-Ada",
        name: "Ada",
        muted: false,
        deafened: false,
        camera: false,
        screen: false,
        speaking: false,
        soundboard: false,
      },
    ],
  });

  const mediaChanged = nextMessage(observer);
  caller.send(
    JSON.stringify({
      type: "media-state",
      muted: true,
      camera: true,
      screen: false,
    }),
  );
  assert.deepEqual(await mediaChanged, {
    type: "presence",
    roomId: "lounge",
    participants: [
      {
        userId: "test-Ada",
        name: "Ada",
        muted: true,
        deafened: false,
        camera: true,
        screen: false,
        speaking: false,
        soundboard: false,
      },
    ],
  });

  for (const deafened of [true, false]) {
    const changed = nextMessage(observer);
    caller.send(
      JSON.stringify({ type: "media-state", muted: false, deafened }),
    );
    const presence = await changed;
    assert.equal(presence.participants[0].deafened, deafened);
    assert.equal(
      presence.participants[0].muted,
      deafened,
      "Deafening must also announce a muted microphone",
    );
  }
  const emptyAgain = nextMessage(observer);
  caller.close();
  assert.deepEqual(await emptyAgain, {
    type: "presence",
    roomId: "lounge",
    participants: [],
  });
});

test("group presence is broadcast immediately on join and leave", async () => {
  const url = await startServer();
  const observer = await connect(url);
  const participant = await connect(url, "Grace");

  const initiallyEmpty = nextMessage(observer);
  observer.send(
    JSON.stringify({ type: "subscribe-presence", roomIds: ["group-room"] }),
  );
  await initiallyEmpty;

  const joined = nextMessage(observer);
  participant.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      participantName: "Grace",
      present: true,
    }),
  );
  assert.deepEqual(await joined, {
    type: "presence",
    roomId: "group-room",
    participants: [
      {
        userId: "test-Grace",
        name: "Grace",
        muted: false,
        deafened: false,
        camera: false,
        screen: false,
        speaking: false,
        soundboard: false,
      },
    ],
  });

  for (const deafened of [true, false]) {
    const changed = nextMessage(observer);
    participant.send(
      JSON.stringify({
        type: "set-group-presence",
        roomId: "group-room",
        present: true,
        muted: false,
        deafened,
      }),
    );
    const presence = await changed;
    assert.equal(presence.participants[0].deafened, deafened);
    assert.equal(presence.participants[0].muted, deafened);
  }
  const left = nextMessage(observer);
  participant.send(
    JSON.stringify({
      type: "set-group-presence",
      roomId: "group-room",
      present: false,
    }),
  );
  assert.deepEqual(await left, {
    type: "presence",
    roomId: "group-room",
    participants: [],
  });
});
