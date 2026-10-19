import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

export function createSignalingServer({ port = 3001, maxPeers = 2 } = {}) {
  const server = new WebSocketServer({ port });
  const rooms = new Map();

  const peersFor = (roomId) => {
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    return rooms.get(roomId);
  };

  server.on("connection", (socket) => {
    let joinedRoomId;

    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (message.type === "join") {
        if (joinedRoomId || typeof message.roomId !== "string") return;

        const peers = peersFor(message.roomId);
        if (peers.size >= maxPeers) {
          socket.send(JSON.stringify({ type: "room-full" }));
          return;
        }

        joinedRoomId = message.roomId;
        const hasPeer = peers.size > 0;
        peers.add(socket);
        socket.send(JSON.stringify({ type: "joined", initiator: !hasPeer }));

        for (const peer of peers) {
          if (peer !== socket && peer.readyState === WebSocket.OPEN) {
            peer.send(JSON.stringify({ type: "peer-joined" }));
          }
        }
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
      if (!joinedRoomId) return;

      const peers = peersFor(joinedRoomId);
      peers.delete(socket);
      for (const peer of peers) {
        if (peer.readyState === WebSocket.OPEN) {
          peer.send(JSON.stringify({ type: "peer-left" }));
        }
      }
      if (peers.size === 0) rooms.delete(joinedRoomId);
    });
  });

  return server;
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
