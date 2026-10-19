import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, test } from "node:test";
import WebSocket from "ws";
import { createSignalingServer } from "../server/signaling.mjs";

const resources = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    if (resource instanceof WebSocket) resource.close();
    else await new Promise((resolve) => resource.close(resolve));
  }
});

async function startServer(options) {
  const server = createSignalingServer({ port: 0, ...options });
  resources.push(server);
  await once(server, "listening");
  const address = server.address();
  return `ws://127.0.0.1:${address.port}`;
}

async function connect(url) {
  const socket = new WebSocket(url);
  resources.unshift(socket);
  await once(socket, "open");
  return socket;
}

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
