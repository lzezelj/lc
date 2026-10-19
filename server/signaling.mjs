import { WebSocketServer } from "ws";

const port = Number(process.env.SIGNAL_PORT ?? 3001);
const server = new WebSocketServer({ port });
const rooms = new Map();
const peersFor = (roomId) => {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
};

server.on("listening", () =>
  console.log(`LC signaling server listening on ws://localhost:${port}`),
);
server.on("error", (error) => {
  if (error.code === "EADDRINUSE")
    console.error(
      `Port ${port} is already in use. Stop the other signaling process or set SIGNAL_PORT to a free port.`,
    );
  else console.error("Signaling server error:", error);
  process.exitCode = 1;
});

server.on("connection", (socket) => {
  let roomId;
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type === "join") {
      roomId = message.roomId;
      const peers = peersFor(roomId);
      if (peers.size >= 2)
        return socket.send(JSON.stringify({ type: "room-full" }));
      const hasPeer = peers.size === 1;
      peers.add(socket);
      socket.send(JSON.stringify({ type: "joined", initiator: !hasPeer }));
      for (const peer of peers)
        if (peer !== socket && peer.readyState === peer.OPEN)
          peer.send(JSON.stringify({ type: "peer-joined" }));
      return;
    }
    if (!roomId) return;
    for (const peer of peersFor(roomId))
      if (peer !== socket && peer.readyState === peer.OPEN)
        peer.send(JSON.stringify(message));
  });
  socket.on("close", () => {
    if (!roomId) return;
    const peers = peersFor(roomId);
    peers.delete(socket);
    for (const peer of peers)
      if (peer.readyState === peer.OPEN)
        peer.send(JSON.stringify({ type: "peer-left" }));
    if (peers.size === 0) rooms.delete(roomId);
  });
});
