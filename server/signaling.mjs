import "dotenv/config";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { verifySignalingToken } from "./signaling-auth.mjs";
import { createVoiceSessions } from "./voice-sessions.mjs";
import { TypingTracker } from "./typing.mjs";

export function createSignalingServer({
  port = 3001,
  maxPeers = 2,
  pendingVoiceTimeoutMs = 30_000,
  heartbeatIntervalMs = 30_000,
  authSecret = process.env.AUTH_SECRET,
  internalSecret = process.env.SIGNALING_INTERNAL_SECRET ?? authSecret,
  removeGroupMedia = async (userId, keepSessionId) => {
    const appUrl =
      process.env.APP_INTERNAL_URL ??
      (process.env.NODE_ENV === "production"
        ? "http://app:3000"
        : "http://127.0.0.1:3000");
    const response = await fetch(`${appUrl}/api/internal/voice-media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${internalSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId, keepSessionId }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Could not remove previous group media");
  },
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
      request.url === "/internal/admin-presence"
    ) {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret))
        return response.writeHead(401).end("Unauthorized");
      readJsonBody(request)
        .then((body) => {
          if (
            !Array.isArray(body.userIds) ||
            body.userIds.length > 50 ||
            body.userIds.some((id) => typeof id !== "string")
          )
            return response.writeHead(400).end("Invalid users");
          const connected = new Set(
            [...ws.clients]
              .filter((client) => client.readyState === WebSocket.OPEN)
              .map((client) => client.identity?.sub),
          );
          response.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          });
          response.end(
            JSON.stringify(
              Object.fromEntries(
                body.userIds.map((id) => [
                  id,
                  connected.has(id)
                    ? (userStatuses.get(id) ?? "online")
                    : "offline",
                ]),
              ),
            ),
          );
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/claim-voice") {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret))
        return response.writeHead(401).end("Unauthorized");
      readJsonBody(request)
        .then(async (body) => {
          if (
            ![body.userId, body.roomId, body.sessionId].every(
              (value) =>
                typeof value === "string" &&
                value.length > 0 &&
                value.length <= 200,
            )
          )
            return response.writeHead(400).end("Invalid voice session");
          if (deletedChannels.has(body.roomId))
            return response.writeHead(403).end("Channel deleted");
          try {
            const admitted = await voiceSessions.claim(
              body.userId,
              {
                id: body.sessionId,
                roomId: body.roomId,
                kind: "group",
              },
              () => !response.destroyed && !deletedChannels.has(body.roomId),
            );
            response.writeHead(admitted ? 204 : 409).end();
          } catch {
            response.writeHead(503).end("Could not transfer voice connection");
          }
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
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
    if (
      request.method === "POST" &&
      request.url === "/internal/message-reactions-changed"
    ) {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret))
        return response.writeHead(401).end("Unauthorized");
      readJsonBody(request)
        .then((body) => {
          if (
            typeof body.channelId !== "string" ||
            typeof body.messageId !== "string"
          )
            return response.writeHead(400).end("Invalid reaction event");
          for (const client of ws.clients)
            if (
              client.readyState === WebSocket.OPEN &&
              (client.subscribedTextChannelId === body.channelId ||
                (client.subscribedWorkspace &&
                  client.allowedChannelIds.has(body.channelId)))
            )
              client.send(
                JSON.stringify({
                  type: "message-reactions-changed",
                  messageId: body.messageId,
                }),
              );
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
      request.url === "/internal/message-edited"
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
            typeof body.edit?.id !== "string" ||
            typeof body.edit.text !== "string" ||
            body.edit.text.length > 4000 ||
            typeof body.edit.editedAt !== "string" ||
            !Number.isFinite(Date.parse(body.edit.editedAt))
          ) {
            response.writeHead(400).end("Invalid edit");
            return;
          }
          for (const client of ws.clients) {
            if (client.readyState !== WebSocket.OPEN) continue;
            if (client.subscribedTextChannelId === body.channelId)
              client.send(
                JSON.stringify({
                  type: "message-edited",
                  channelId: body.channelId,
                  edit: body.edit,
                }),
              );
            if (
              client.subscribedWorkspace &&
              client.allowedChannelIds.has(body.channelId)
            )
              client.send(
                JSON.stringify({
                  type: "channel-history-changed",
                  channelId: body.channelId,
                }),
              );
          }
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
              client.send(
                JSON.stringify({
                  type: "access-changed",
                  ...(body.reason === "server-kicked" &&
                  typeof body.serverId === "string"
                    ? {
                        reason: body.reason,
                        serverId: body.serverId,
                        serverName:
                          typeof body.serverName === "string"
                            ? body.serverName
                            : "the server",
                      }
                    : {}),
                }),
              );
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
              body.event.type === "profile-updated" &&
              typeof body.event.name === "string" &&
              client.identity?.sub === body.event.userId &&
              client.identity.name !== body.event.name
            ) {
              client.identity.name = body.event.name;
              client.participantName = body.event.name;
              for (const [roomId, person] of client.groupPresence ?? []) {
                client.groupPresence.set(roomId, {
                  ...person,
                  name: body.event.name,
                });
                broadcastPresence(roomId);
              }
              for (const [roomId, peers] of rooms)
                if (peers.has(client)) broadcastPresence(roomId);
            }
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
    if (
      request.method === "POST" &&
      request.url === "/internal/channel-deleted"
    ) {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret))
        return response.writeHead(401).end("Unauthorized");
      readJsonBody(request)
        .then((body) => {
          if (
            typeof body.channelId !== "string" ||
            typeof body.serverId !== "string"
          )
            return response.writeHead(400).end("Invalid channel");
          deletedChannels.add(body.channelId);
          // Issued tokens last 60 seconds; existing sockets lose access permanently.
          setTimeout(
            () => deletedChannels.delete(body.channelId),
            65000,
          ).unref();
          for (const client of ws.clients) {
            if (!client.identity?.serverIds.includes(body.serverId)) continue;
            client.allowedChannelIds.delete(body.channelId);
            client.groupPresence?.delete(body.channelId);
            if (client.subscribedTextChannelId === body.channelId)
              client.subscribedTextChannelId = undefined;
            if (client.readyState === WebSocket.OPEN)
              client.send(
                JSON.stringify({
                  type: "channel-deleted",
                  channelId: body.channelId,
                  serverId: body.serverId,
                  ...(body.reason === "admin" ? { reason: "admin" } : {}),
                }),
              );
          }
          for (const peer of peersFor(body.channelId))
            peer.close(4003, "Channel deleted");
          broadcastPresence(body.channelId);
          response.writeHead(204).end();
        })
        .catch(() => response.writeHead(400).end("Invalid JSON"));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/move-voice") {
      const supplied = request.headers.authorization?.replace(
        /^Bearer\s+/i,
        "",
      );
      if (!secretsMatch(supplied, internalSecret))
        return response.writeHead(401).end("Unauthorized");
      readJsonBody(request)
        .then((body) => {
          const channel = body.channel;
          if (
            typeof body.userId !== "string" ||
            typeof body.roomId !== "string" ||
            !channel ||
            typeof channel.id !== "string" ||
            typeof channel.name !== "string" ||
            typeof channel.serverId !== "string" ||
            !["voice_direct", "voice_group"].includes(channel.type) ||
            channel.id === body.roomId ||
            body.roomId.startsWith("friend:") ||
            channel.id.startsWith("friend:")
          )
            return response.writeHead(400).end("Invalid voice move");
          const present =
            [...(rooms.get(body.roomId) ?? [])].some(
              (client) =>
                client.identity.sub === body.userId &&
                client.readyState === WebSocket.OPEN,
            ) ||
            [...ws.clients].some(
              (client) =>
                client.identity.sub === body.userId &&
                client.readyState === WebSocket.OPEN &&
                client.groupPresence?.has(body.roomId),
            );
          if (
            !present ||
            deletedChannels.has(body.roomId) ||
            deletedChannels.has(channel.id)
          )
            return response
              .writeHead(404)
              .end("Participant or channel unavailable");
          const occupants = [...(rooms.get(channel.id) ?? [])].filter(
            (client) =>
              client.readyState === WebSocket.OPEN &&
              client.identity.sub !== body.userId,
          );
          if (channel.type === "voice_direct" && occupants.length >= maxPeers)
            return response.writeHead(409).end("Destination full");
          const recipients = [...ws.clients].filter(
            (client) =>
              client.identity.sub === body.userId &&
              client.readyState === WebSocket.OPEN &&
              client.subscribedWorkspace &&
              client.allowedChannelIds.has(body.roomId) &&
              client.allowedChannelIds.has(channel.id),
          );
          if (!recipients.length)
            return response.writeHead(409).end("Recipient unavailable");
          const event = JSON.stringify({
            type: "voice-move",
            roomId: body.roomId,
            channel,
          });
          recipients.forEach((client) => client.send(event));
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
  // Browser WebSockets answer protocol pings automatically, even in idle tabs.
  const heartbeat = setInterval(() => {
    for (const socket of ws.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (socket.heartbeatAlive === false) {
        socket.terminate();
        continue;
      }
      socket.heartbeatAlive = false;
      socket.ping();
    }
  }, heartbeatIntervalMs);
  heartbeat.unref();
  server.once("close", () => clearInterval(heartbeat));
  const rooms = new Map();
  const deletedChannels = new Set();
  const typing = new TypingTracker((context, users) => {
    for (const client of ws.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (context.channelId) {
        if (
          deletedChannels.has(context.channelId) ||
          !client.allowedChannelIds.has(context.channelId) ||
          !(
            client.subscribedWorkspace ||
            client.subscribedTextChannelId === context.channelId
          )
        )
          continue;
        client.send(
          JSON.stringify({
            type: "typing",
            channelId: context.channelId,
            users,
          }),
        );
      } else if (context.pair.includes(client.identity.sub)) {
        const partner = context.pair.find((id) => id !== client.identity.sub);
        if (client.identity.friendIds.includes(partner))
          client.send(
            JSON.stringify({ type: "typing", userId: partner, users }),
          );
      }
    }
  });
  const typingTimer = setInterval(() => typing.expire(), 1000);
  typingTimer.unref();
  server.once("close", () => clearInterval(typingTimer));
  const userStatuses = new Map();
  const automaticAwayUsers = new Set();
  const validStatuses = new Set(["online", "away", "dnd", "invisible"]);
  const voiceSessions = createVoiceSessions({
    removeGroupMedia,
    onReplace(userId, previous, next) {
      const event = JSON.stringify({
        type: "voice-replaced",
        sessionId: previous.id,
      });
      for (const client of ws.clients) {
        if (client.identity?.sub !== userId) continue;
        if (
          previous.id !== next.id &&
          client.readyState === WebSocket.OPEN &&
          (client.subscribedWorkspace || client.voiceSessionId === previous.id)
        )
          client.send(event);
        for (const roomId of client.groupPresence?.keys() ?? []) {
          client.groupPresence.delete(roomId);
          broadcastPresence(roomId);
        }
      }
      for (const [roomId, peers] of rooms) {
        let changed = false;
        for (const peer of peers) {
          if (peer.identity.sub !== userId) continue;
          changed = true;
          peers.delete(peer);
          peer.close(4000, "Voice connection transferred");
          if (roomId !== next.roomId || next.kind !== "direct")
            for (const remaining of peers)
              if (remaining.readyState === WebSocket.OPEN)
                remaining.send(
                  JSON.stringify({
                    type: "peer-left",
                    userId: peer.identity.sub,
                  }),
                );
        }
        if (changed) broadcastPresence(roomId);
        if (!peers.size) rooms.delete(roomId);
      }
    },
  });

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

  const presenceFor = (roomId) => {
    const connected = [
      ...[...(rooms.get(roomId) ?? [])].map((peer) => ({
        userId: peer.identity.sub,
        name: peer.participantName ?? "Guest",
        muted: Boolean(peer.mediaState?.muted),
        deafened: Boolean(peer.mediaState?.deafened),
        camera: Boolean(peer.mediaState?.camera),
        screen: Boolean(peer.mediaState?.screen),
        speaking: Boolean(peer.mediaState?.speaking),
        soundboard: Boolean(peer.mediaState?.soundboard),
      })),
      ...[...ws.clients]
        .filter((client) => client.groupPresence?.has(roomId))
        .map((client) => client.groupPresence.get(roomId)),
    ];
    const participants = [...connected];
    for (const client of ws.clients) {
      if (
        client.pendingVoice?.roomId === roomId &&
        client.readyState === WebSocket.OPEN &&
        !participants.some((person) => person.userId === client.identity.sub)
      )
        participants.push({
          userId: client.identity.sub,
          name: client.identity.name,
          muted: true,
          camera: false,
          screen: false,
          speaking: false,
          connecting: true,
        });
    }
    return participants;
  };

  const clearPendingVoice = (client) => {
    const roomId = client.pendingVoice?.roomId;
    if (!roomId) return;
    clearTimeout(client.pendingVoice.timer);
    client.pendingVoice = null;
    return roomId;
  };

  const completePendingVoice = (userId, roomId) => {
    for (const client of ws.clients)
      if (
        client.identity.sub === userId &&
        client.pendingVoice?.roomId === roomId
      )
        clearPendingVoice(client);
  };

  const broadcastPresence = (roomId) => {
    const message = JSON.stringify({
      type: "presence",
      roomId,
      participants: presenceFor(roomId),
    });
    for (const client of ws.clients) {
      if (
        (client.subscribedRoomIds?.has(roomId) ||
          (client.subscribedWorkspace &&
            client.allowedChannelIds.has(roomId))) &&
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
      if (
        client.subscribedWorkspace &&
        client.allowedChannelIds.has(channelId) &&
        client.readyState === WebSocket.OPEN
      ) {
        client.send(
          JSON.stringify({
            type: "channel-activity",
            channelId,
            messageId: message.id,
            createdAt: message.createdAt,
            authorId: message.authorId,
          }),
        );
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
      if (
        client.subscribedWorkspace &&
        client.allowedChannelIds.has(channelId) &&
        client.readyState === WebSocket.OPEN
      )
        client.send(
          JSON.stringify({ type: "channel-activity-changed", channelId }),
        );
    }
  };

  const broadcastOnlinePresence = (serverId) => {
    const userIds = [
      ...new Set(
        [...ws.clients]
          .filter(
            (client) =>
              client.readyState === WebSocket.OPEN &&
              client.identity?.serverIds?.includes(serverId) &&
              userStatuses.get(client.identity.sub) !== "invisible",
          )
          .map((client) => client.identity.sub),
      ),
    ];
    const outgoing = JSON.stringify({
      type: "online-presence",
      serverId,
      userIds,
      statuses: Object.fromEntries(
        userIds.map((id) => [id, userStatuses.get(id) ?? "online"]),
      ),
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

  const broadcastUserPresence = () => {
    const connected = [...ws.clients].filter(
      (client) => client.readyState === WebSocket.OPEN && client.identity,
    );
    for (const viewer of connected) {
      if (!viewer.subscribedUserPresence) continue;
      const userIds = [
        ...new Set(
          connected
            .filter(
              (subject) =>
                userStatuses.get(subject.identity.sub) !== "invisible" &&
                (viewer.identity.sub === subject.identity.sub ||
                  viewer.identity.friendIds.includes(subject.identity.sub) ||
                  viewer.identity.serverIds.some((id) =>
                    subject.identity.serverIds.includes(id),
                  )),
            )
            .map((subject) => subject.identity.sub),
        ),
      ];
      viewer.send(
        JSON.stringify({
          type: "user-presence",
          userIds,
          statuses: Object.fromEntries(
            userIds.map((id) => [id, userStatuses.get(id) ?? "online"]),
          ),
        }),
      );
    }
  };

  ws.on("connection", (socket, request) => {
    socket.heartbeatAlive = true;
    socket.on("pong", () => {
      socket.heartbeatAlive = true;
    });
    socket.identity = request.signalingIdentity;
    socket.allowedChannelIds = new Set(socket.identity.channelIds);
    if (!userStatuses.has(socket.identity.sub)) {
      const requested = new URL(
        request.url ?? "/",
        "ws://signaling.local",
      ).searchParams.get("status");
      userStatuses.set(
        socket.identity.sub,
        validStatuses.has(requested) ? requested : "online",
      );
    }
    let joinedRoomId;

    // A website-level socket makes the user online in every server they can
    // access, regardless of which application screen they are viewing.
    socket.identity.serverIds.forEach(broadcastOnlinePresence);
    broadcastUserPresence();

    const isAllowed = (channelId) => {
      if (deletedChannels.has(channelId)) return false;
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

      if (!message || typeof message !== "object" || Array.isArray(message))
        return;

      if (message.type === "typing") {
        if (typeof message.active !== "boolean") return;
        let context;
        if (
          typeof message.channelId === "string" &&
          !message.userId &&
          !deletedChannels.has(message.channelId) &&
          socket.allowedChannelIds.has(message.channelId)
        )
          context = {
            key: `channel:${message.channelId}`,
            channelId: message.channelId,
          };
        else if (
          typeof message.userId === "string" &&
          !message.channelId &&
          message.userId !== socket.identity.sub &&
          socket.identity.friendIds.includes(message.userId)
        ) {
          const pair = [socket.identity.sub, message.userId].sort();
          context = { key: `direct:${JSON.stringify(pair)}`, pair };
        }
        if (!context) return;
        if (message.active && Date.now() - (socket.lastTypingAt ?? 0) < 1000)
          return;
        if (message.active) socket.lastTypingAt = Date.now();
        typing.update(
          socket,
          context,
          { id: socket.identity.sub, name: socket.identity.name },
          message.active,
        );
        return;
      }
      if (message.type === "subscribe-user-presence") {
        socket.subscribedUserPresence = true;
        broadcastUserPresence();
        return;
      }
      if (message.type === "subscribe-workspace") {
        socket.subscribedWorkspace = true;
        // The signed token controls the complete subscription. Client-supplied
        // channel/server IDs cannot expand access or expose friend-call rooms.
        for (const roomId of socket.allowedChannelIds) {
          if (!deletedChannels.has(roomId))
            socket.send(
              JSON.stringify({
                type: "presence",
                roomId,
                participants: presenceFor(roomId),
              }),
            );
        }
        return;
      }
      if (message.type === "get-user-status") {
        socket.send(
          JSON.stringify({
            type: "user-status",
            status: userStatuses.get(socket.identity.sub) ?? "online",
            automatic: automaticAwayUsers.has(socket.identity.sub),
          }),
        );
        return;
      }
      if (message.type === "set-user-status") {
        if (!validStatuses.has(message.status)) return;
        userStatuses.set(socket.identity.sub, message.status);
        if (message.status === "away" && message.automatic === true)
          automaticAwayUsers.add(socket.identity.sub);
        else automaticAwayUsers.delete(socket.identity.sub);
        const serverIds = new Set();
        for (const client of ws.clients) {
          if (
            client.identity?.sub !== socket.identity.sub ||
            client.readyState !== WebSocket.OPEN
          )
            continue;
          client.send(
            JSON.stringify({
              type: "user-status",
              status: message.status,
              automatic: automaticAwayUsers.has(socket.identity.sub),
            }),
          );
          client.identity.serverIds.forEach((id) => serverIds.add(id));
        }
        serverIds.forEach(broadcastOnlinePresence);
        broadcastUserPresence();
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
        message.type === "set-voice-pending" &&
        typeof message.roomId === "string"
      ) {
        if (
          !socket.allowedChannelIds.has(message.roomId) ||
          deletedChannels.has(message.roomId)
        ) {
          rejectForbidden(message.roomId);
          return;
        }
        if (
          message.present !== true &&
          socket.pendingVoice?.roomId !== message.roomId
        )
          return;
        const previous = clearPendingVoice(socket);
        if (message.present === true) {
          const roomId = message.roomId;
          const timer = setTimeout(() => {
            if (socket.pendingVoice?.roomId !== roomId) return;
            clearPendingVoice(socket);
            broadcastPresence(roomId);
          }, pendingVoiceTimeoutMs);
          timer.unref();
          socket.pendingVoice = { roomId, timer };
        }
        if (previous && previous !== message.roomId)
          broadcastPresence(previous);
        broadcastPresence(message.roomId);
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
        if (
          message.present &&
          socket.groupReclaimSessionId === message.sessionId &&
          message.sessionId
        )
          return;
        if (
          message.present &&
          message.reconnecting === true &&
          typeof message.sessionId === "string" &&
          !voiceSessions.confirm(socket.identity.sub, message.sessionId)
        ) {
          socket.groupReclaimSessionId = message.sessionId;
          void voiceSessions
            .claim(
              socket.identity.sub,
              {
                id: message.sessionId,
                roomId: message.roomId,
                kind: "group",
              },
              () =>
                socket.readyState === WebSocket.OPEN &&
                isAllowed(message.roomId),
            )
            .then((admitted) => {
              socket.groupReclaimSessionId = null;
              if (!admitted) return;
              socket.groupVoiceSessionId = message.sessionId;
              voiceSessions.confirm(socket.identity.sub, message.sessionId);
              socket.groupPresence.set(message.roomId, {
                userId: socket.identity.sub,
                name: socket.identity.name,
                muted: Boolean(message.muted) || Boolean(message.deafened),
                deafened: Boolean(message.deafened),
                camera: Boolean(message.camera),
                screen: Boolean(message.screen),
                speaking: Boolean(message.speaking),
                soundboard: Boolean(message.soundboard),
              });
              completePendingVoice(socket.identity.sub, message.roomId);
              broadcastPresence(message.roomId);
            })
            .catch(() => {
              socket.groupReclaimSessionId = null;
              if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ type: "voice-transfer-failed" }));
            });
          return;
        }
        if (message.present) {
          if (
            message.sessionId &&
            !voiceSessions.confirm(socket.identity.sub, message.sessionId)
          ) {
            socket.send(
              JSON.stringify({
                type: "voice-replaced",
                sessionId: message.sessionId,
              }),
            );
            return;
          }
          socket.groupVoiceSessionId = message.sessionId;
          completePendingVoice(socket.identity.sub, message.roomId);
          const name = socket.identity.name;
          socket.groupPresence.set(message.roomId, {
            userId: socket.identity.sub,
            name,
            muted: Boolean(message.muted) || Boolean(message.deafened),
            deafened: Boolean(message.deafened),
            camera: Boolean(message.camera),
            screen: Boolean(message.screen),
            speaking: Boolean(message.speaking),
            soundboard: Boolean(message.soundboard),
          });
        } else {
          socket.groupPresence.delete(message.roomId);
          if (message.sessionId)
            voiceSessions.release(socket.identity.sub, message.sessionId);
        }
        broadcastPresence(message.roomId);
        return;
      }

      if (message.type === "media-state" && joinedRoomId) {
        socket.mediaState = {
          muted: Boolean(message.muted) || Boolean(message.deafened),
          deafened: Boolean(message.deafened),
          camera: Boolean(message.camera),
          screen: Boolean(message.screen),
          speaking: Boolean(message.speaking),
          soundboard: Boolean(message.soundboard),
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

        if (socket.voiceJoinPending) return;
        const available = () =>
          [...peersFor(message.roomId)].filter(
            (peer) => peer.identity.sub !== socket.identity.sub,
          ).length < maxPeers;
        if (!available()) {
          socket.send(JSON.stringify({ type: "room-full" }));
          return;
        }
        socket.voiceJoinPending = true;
        socket.voiceSessionId =
          typeof message.sessionId === "string"
            ? message.sessionId
            : randomUUID();
        void voiceSessions
          .claim(
            socket.identity.sub,
            {
              id: socket.voiceSessionId,
              roomId: message.roomId,
              kind: "direct",
              socket,
              reconnecting: message.reconnecting === true,
            },
            () =>
              socket.readyState === WebSocket.OPEN &&
              isAllowed(message.roomId) &&
              available(),
          )
          .then((admitted) => {
            socket.voiceJoinPending = false;
            if (!admitted) {
              if (socket.readyState === WebSocket.OPEN)
                socket.send(
                  JSON.stringify(
                    message.reconnecting
                      ? {
                          type: "voice-replaced",
                          sessionId: socket.voiceSessionId,
                        }
                      : { type: "room-full" },
                  ),
                );
              return;
            }
            if (!available()) {
              voiceSessions.release(socket.identity.sub, socket.voiceSessionId);
              socket.send(JSON.stringify({ type: "room-full" }));
              return;
            }
            const peers = peersFor(message.roomId);
            joinedRoomId = message.roomId;
            socket.participantName = socket.identity.name;
            const hasPeer = peers.size > 0;
            peers.add(socket);
            completePendingVoice(socket.identity.sub, joinedRoomId);
            socket.send(
              JSON.stringify({ type: "joined", initiator: !hasPeer }),
            );

            for (const peer of peers) {
              if (peer !== socket && peer.readyState === WebSocket.OPEN) {
                peer.send(
                  JSON.stringify({
                    type: "peer-joined",
                    userId: socket.identity.sub,
                  }),
                );
              }
            }
            broadcastPresence(joinedRoomId);
          })
          .catch(() => {
            socket.voiceJoinPending = false;
            if (socket.readyState === WebSocket.OPEN)
              socket.send(JSON.stringify({ type: "voice-transfer-failed" }));
          });
        return;
      }

      if (!joinedRoomId || !peersFor(joinedRoomId).has(socket)) return;
      for (const peer of peersFor(joinedRoomId)) {
        if (peer !== socket && peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify(message));
        }
      }
    });

    socket.on("close", () => {
      typing.clear(socket);
      voiceSessions.suspend(socket.identity.sub, socket.voiceSessionId, socket);
      voiceSessions.suspend(socket.identity.sub, socket.groupVoiceSessionId);
      const pendingRoom = clearPendingVoice(socket);
      if (pendingRoom) broadcastPresence(pendingRoom);
      if (
        ![...ws.clients].some(
          (client) =>
            client !== socket &&
            client.identity?.sub === socket.identity.sub &&
            client.readyState === WebSocket.OPEN,
        )
      ) {
        userStatuses.delete(socket.identity.sub);
        automaticAwayUsers.delete(socket.identity.sub);
      }
      for (const serverId of socket.identity.serverIds) {
        broadcastOnlinePresence(serverId);
      }
      broadcastUserPresence();
      for (const roomId of socket.groupPresence?.keys() ?? []) {
        socket.groupPresence.delete(roomId);
        broadcastPresence(roomId);
      }
      if (!joinedRoomId) return;

      const peers = rooms.get(joinedRoomId);
      if (!peers?.delete(socket)) return;
      for (const peer of peers) {
        if (peer.readyState === WebSocket.OPEN) {
          peer.send(
            JSON.stringify({ type: "peer-left", userId: socket.identity.sub }),
          );
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
