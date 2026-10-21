import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createSignalingToken } from "../server/signaling-auth.mjs";
import { createSignalingServer } from "../server/signaling.mjs";

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
) {
  const token = createSignalingToken(
    { id: `test-${name}`, name, channelIds },
    authSecret,
  );
  const socket = new WebSocket(`${url}?token=${token}`);
  resources.unshift(socket);
  await once(socket, "open");
  return socket;
}

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

function nextMessage(socket) {
  return once(socket, "message").then(([data]) => JSON.parse(data.toString()));
}

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
  const first = await connect(url);
  const second = await connect(url);

  const firstJoined = nextMessage(first);
  first.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.deepEqual(await firstJoined, { type: "joined", initiator: true });

  const secondJoined = nextMessage(second);
  const peerJoined = nextMessage(first);
  second.send(JSON.stringify({ type: "join", roomId: "lounge" }));
  assert.deepEqual(await secondJoined, { type: "joined", initiator: false });
  assert.deepEqual(await peerJoined, { type: "peer-joined" });

  const relayedChat = nextMessage(second);
  first.send(JSON.stringify({ type: "chat", text: "hello" }));
  assert.deepEqual(await relayedChat, { type: "chat", text: "hello" });

  const peerLeft = nextMessage(first);
  second.close();
  assert.deepEqual(await peerLeft, { type: "peer-left" });
});

test("room capacity is configurable and rejected peers never join", async () => {
  const url = await startServer({ maxPeers: 1 });
  const first = await connect(url);
  const rejected = await connect(url);

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
  const first = await connect(url);
  const partner = await connect(url);
  const outsider = await connect(url);

  for (const [socket, roomId] of [
    [first, "lounge"],
    [partner, "lounge"],
    [outsider, "other-room"],
  ]) {
    const joined = nextMessage(socket);
    socket.send(JSON.stringify({ type: "join", roomId }));
    await joined;
    if (socket === partner) await nextMessage(first);
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
        name: "Ada",
        muted: false,
        camera: false,
        screen: false,
        speaking: false,
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
        name: "Ada",
        muted: true,
        camera: true,
        screen: false,
        speaking: false,
      },
    ],
  });

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
        name: "Grace",
        muted: false,
        camera: false,
        screen: false,
        speaking: false,
      },
    ],
  });

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
