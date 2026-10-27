import "dotenv/config";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { verifySignalingToken } from "./signaling-auth.mjs";

export function createSignalingServer({
  port = 3001,
  maxPeers = 2,
  authSecret = process.env.AUTH_SECRET,
  internalSecret = process.env.SIGNALING_INTERNAL_SECRET ?? authSecret,
} = {}) {
  if (!authSecret) throw new Error("AUTH_SECRET is required");
  if (!internalSecret) throw new Error("SIGNALING_INTERNAL_SECRET is required");
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ status: "ok", websocketClients: ws.clients.size }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/internal/server-updated"
    ) {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret))
        return response.writeHead(401).end("Unauthorized");
      readJsonBody(request)
        .then((body) => {
          if (typeof body.serverId !== "string")
            return response.writeHead(400).end("Invalid server");
          for (const client of ws.clients) {
            if (
              client.readyState === WebSocket.OPEN &&
              client.identity?.serverIds.includes(body.serverId)
            )
              client.send(
                JSON.stringify({
                  type: "server-updated",
                  serverId: body.serverId,
                }),
              );
          }
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/text-message") {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret)) {
        response.writeHead(401).end("Unauthorized");
        return;
      }
      readJsonBody(request)
        .then((body) => {
          if (
            typeof body.channelId !== "string" ||
            !body.message ||
            typeof body.message.id !== "string" ||
            typeof body.message.text !== "string" ||
            typeof body.message.author !== "string"
          ) {
            response.writeHead(400).end("Invalid message");
            return;
          }
          broadcastTextMessage(body.channelId, body.message);
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/internal/message-deleted"
    ) {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret)) {
        response.writeHead(401).end("Unauthorized");
        return;
      }
      readJsonBody(request)
        .then((body) => {
          if (
            typeof body.channelId !== "string" ||
            typeof body.messageId !== "string"
          ) {
            response.writeHead(400).end("Invalid deletion");
            return;
          }
          broadcastMessageDeletion(
            body.channelId,
            body.messageId,
            body.permanent === true,
          );
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/internal/disconnect-user"
    ) {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret)) {
        response.writeHead(401).end("Unauthorized");
        return;
      }
      readJsonBody(request)
        .then((body) => {
          if (typeof body.userId !== "string") {
            response.writeHead(400).end("Invalid user");
            return;
          }
          for (const client of ws.clients) {
            if (client.identity?.sub === body.userId) {
              client.send(JSON.stringify({ type: "access-changed" }));
              client.close(4003, "Access changed");
            }
          }
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/user-event") {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret)) {
        response.writeHead(401).end("Unauthorized");
        return;
      }
      readJsonBody(request)
        .then((body) => {
          if (
            typeof body.userId !== "string" ||
            !body.event ||
            typeof body.event.type !== "string"
          ) {
            response.writeHead(400).end("Invalid user event");
            return;
          }
          for (const client of ws.clients) {
            if (
              client.identity?.sub === body.userId &&
              client.readyState === WebSocket.OPEN
            ) {
              client.send(JSON.stringify(body.event));
            }
          }
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/kick-voice") {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret)) {
        response.writeHead(401).end("Unauthorized");
        return;
      }
      readJsonBody(request)
        .then((body) => {
          if (
            typeof body.userId !== "string" ||
            typeof body.roomId !== "string"
          ) {
            response.writeHead(400).end("Invalid voice target");
            return;
          }
          for (const client of peersFor(body.roomId)) {
            if (client.identity?.sub === body.userId) {
              client.send(JSON.stringify({ type: "voice-kicked" }));
              client.close(4003, "Removed from voice");
            }
          }
          for (const client of ws.clients) {
            if (
              client.identity?.sub === body.userId &&
              client.groupPresence?.delete(body.roomId)
            ) {
              broadcastPresence(body.roomId);
            }
          }
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    response.writeHead(426, { "Content-Type": "text/plain" });
    response.end("Upgrade Required");
  });
  const ws = new WebSocketServer({ noServer: true });
  const rooms = new Map();

  server.on("upgrade", (request, socket, head) => {
    const token = new URL(
      request.url ?? "/",
      "ws://signaling.local",
    ).searchParams.get("token");
    const identity = verifySignalingToken(token, authSecret);
    if (!identity) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    request.signalingIdentity = identity;
    ws.handleUpgrade(request, socket, head, (client) => {
      ws.emit("connection", client, request);
    });
  });

  const peersFor = (roomId) => {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    return rooms.get(roomId);
  };

  const presenceFor = (roomId) => [
    ...[...peersFor(roomId)].map((peer) => ({
      userId: peer.identity.sub,
      name: peer.participantName ?? "Guest",
      muted: Boolean(peer.mediaState?.muted),
      camera: Boolean(peer.mediaState?.camera),
      screen: Boolean(peer.mediaState?.screen),
      speaking: Boolean(peer.mediaState?.speaking),
    })),
    ...[...ws.clients]
      .filter((client) => client.groupPresence?.has(roomId))
      .map((client) => client.groupPresence.get(roomId)),
  ];

  const broadcastPresence = (roomId) => {
    const message = JSON.stringify({
      type: "presence",
      roomId,
      participants: presenceFor(roomId),
    });
    for (const client of ws.clients) {
      if (
        client.subscribedRoomIds?.has(roomId) &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(message);
      }
    }
  };

  const broadcastTextMessage = (channelId, message) => {
    const outgoing = JSON.stringify({
      type: "text-message",
      channelId,
      message,
    });
    for (const client of ws.clients) {
      if (
        client.subscribedTextChannelId === channelId &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(outgoing);
      }
    }
  };

  const broadcastMessageDeletion = (channelId, messageId, permanent) => {
    const outgoing = JSON.stringify({
      type: "message-deleted",
      channelId,
      messageId,
      permanent,
    });
    for (const client of ws.clients) {
      if (
        client.subscribedTextChannelId === channelId &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(outgoing);
      }
    }
  };

  const broadcastOnlinePresence = (serverId) => {
    const userIds = [
      ...new Set(
        [...ws.clients]
          .filter(
            (client) =>
              client.readyState === WebSocket.OPEN &&
              client.identity?.serverIds?.includes(serverId),
          )
          .map((client) => client.identity.sub),
      ),
    ];
    const outgoing = JSON.stringify({
      type: "online-presence",
      serverId,
      userIds,
    });
    for (const client of ws.clients) {
      if (
        client.subscribedOnlineServerId === serverId &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(outgoing);
      }
    }
  };

  ws.on("connection", (socket, request) => {
    socket.identity = request.signalingIdentity;
    socket.allowedChannelIds = new Set(socket.identity.channelIds);
    let joinedRoomId;

    // A website-level socket makes the user online in every server they can
    // access, regardless of which application screen they are viewing.
    socket.identity.serverIds.forEach(broadcastOnlinePresence);

    const isAllowed = (channelId) => {
      if (socket.allowedChannelIds.has(channelId)) return true;
      if (typeof channelId !== "string" || !channelId.startsWith("friend:"))
        return false;
      const pair = channelId.slice("friend:".length).split(":");
      return (
        pair.length === 2 &&
        pair.includes(socket.identity.sub) &&
        socket.identity.friendIds.some((friendId) => pair.includes(friendId))
      );
    };
    const rejectForbidden = (channelId) =>
      socket.send(JSON.stringify({ type: "forbidden", channelId }));

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.type === "subscribe-presence") {
        const requestedRoomIds = Array.isArray(message.roomIds)
          ? message.roomIds
              .filter((roomId) => typeof roomId === "string")
              .slice(0, 100)
          : [];
        const roomIds = requestedRoomIds.filter(isAllowed);
        socket.subscribedRoomIds = new Set(roomIds);
        requestedRoomIds
          .filter((roomId) => !isAllowed(roomId))
          .forEach(rejectForbidden);
        roomIds.forEach((roomId) => broadcastPresence(roomId));
        return;
      }

      if (message.type === "subscribe-online") {
        if (!socket.identity.serverIds.includes(message.serverId)) {
          rejectForbidden(message.serverId);
          return;
        }
        socket.subscribedOnlineServerId = message.serverId;
        broadcastOnlinePresence(message.serverId);
        return;
      }

      if (message.type === "subscribe-text") {
        if (!isAllowed(message.channelId)) {
          rejectForbidden(message.channelId);
          return;
        }
        socket.subscribedTextChannelId =
          typeof message.channelId === "string" ? message.channelId : undefined;
        socket.send(
          JSON.stringify({
            type: "text-subscribed",
            channelId: socket.subscribedTextChannelId,
          }),
        );
        return;
      }

      if (
        ["call-invite", "call-decline", "call-cancel"].includes(message.type) &&
        typeof message.targetUserId === "string"
      ) {
        if (!socket.identity.friendIds.includes(message.targetUserId)) {
          rejectForbidden(message.targetUserId);
          return;
        }
        const roomId = `friend:${[socket.identity.sub, message.targetUserId]
          .sort()
          .join(":")}`;
        const outgoing = JSON.stringify({
          type: message.type,
          fromUserId: socket.identity.sub,
          fromName: socket.identity.name,
          roomId,
        });
        for (const client of ws.clients) {
          if (
            client.identity?.sub === message.targetUserId &&
            client.readyState === WebSocket.OPEN
          ) {
            client.send(outgoing);
          }
        }
        return;
      }

      if (message.type === "text-message") {
        socket.send(JSON.stringify({ type: "forbidden-message-publish" }));
        return;
      }

      if (
        message.type === "set-group-presence" &&
        typeof message.roomId === "string"
      ) {
        if (!isAllowed(message.roomId)) {
          rejectForbidden(message.roomId);
          return;
        }
        socket.groupPresence ??= new Map();
        if (message.present) {
          const name = socket.identity.name;
          socket.groupPresence.set(message.roomId, {
            userId: socket.identity.sub,
            name,
            muted: Boolean(message.muted),
            camera: Boolean(message.camera),
            screen: Boolean(message.screen),
            speaking: Boolean(message.speaking),
          });
        } else {
          socket.groupPresence.delete(message.roomId);
        }
        broadcastPresence(message.roomId);
        return;
      }

      if (message.type === "media-state" && joinedRoomId) {
        socket.mediaState = {
          muted: Boolean(message.muted),
          camera: Boolean(message.camera),
          screen: Boolean(message.screen),
          speaking: Boolean(message.speaking),
        };
        broadcastPresence(joinedRoomId);
        return;
      }

      if (message.type === "join") {
        if (joinedRoomId || typeof message.roomId !== "string") return;
        if (!isAllowed(message.roomId)) {
          rejectForbidden(message.roomId);
          return;
        }

        const peers = peersFor(message.roomId);
        for (const oldPeer of peers) {
          if (oldPeer.identity?.sub === socket.identity.sub) {
            peers.delete(oldPeer);
            oldPeer.close(4000, "Replaced by new connection");
          }
        }
        if (peers.size >= maxPeers) {
          socket.send(JSON.stringify({ type: "room-full" }));
          return;
        }

        joinedRoomId = message.roomId;
        socket.participantName = socket.identity.name;
        const hasPeer = peers.size > 0;
        peers.add(socket);
        socket.send(JSON.stringify({ type: "joined", initiator: !hasPeer }));

        for (const peer of peers) {
          if (peer !== socket && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ type: "peer-joined" }));
          }
        }
        broadcastPresence(joinedRoomId);
        return;
      }

      if (!joinedRoomId) return;
      for (const peer of peersFor(joinedRoomId)) {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify(message));
        }
      }
    });

    socket.on("close", () => {
      for (const serverId of socket.identity.serverIds) {
        broadcastOnlinePresence(serverId);
      }
      for (const roomId of socket.groupPresence?.keys() ?? []) {
        socket.groupPresence.delete(roomId);
        broadcastPresence(roomId);
      }
      if (!joinedRoomId) return;

      const peers = peersFor(joinedRoomId);
      if (!peers.delete(socket)) return;
      for (const peer of peers) {
        if (peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({ type: "peer-left" }));
        }
      }
      broadcastPresence(joinedRoomId);
      if (peers.size === 0) rooms.delete(joinedRoomId);
    });
  });

  server.listen(port);
  return server;
}

function secretsMatch(supplied, expected) {
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20_000) reject(new Error("Body too large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function start() {
  const port = Number(process.env.SIGNAL_PORT ?? 3001);
  const server = createSignalingServer({ port });

  server.on("listening", () => {
    console.log(`LC signaling server listening on ws://localhost:${port}`);
  });
  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other signaling process or set SIGNAL_PORT to a free port.`,
      );
    } else {
      console.error("Signaling server error:", error);
    }
    process.exitCode = 1;
  });
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) start();
