import { createHmac, timingSafeEqual } from "node:crypto";

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createSignalingToken(identity, secret, lifetimeSeconds = 60) {
  if (!secret) throw new Error("AUTH_SECRET is required for signaling tokens");
  const payload = encode({
    sub: identity.id,
    name: identity.name,
    channelIds: identity.channelIds,
    serverIds: identity.serverIds ?? [],
    friendIds: identity.friendIds ?? [],
    exp: Math.floor(Date.now() / 1000) + lifetimeSeconds,
  });
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifySignalingToken(token, secret) {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const receivedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    receivedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(receivedBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      typeof identity.sub !== "string" ||
      typeof identity.name !== "string" ||
      !Array.isArray(identity.channelIds) ||
      !identity.channelIds.every(
        (channelId) => typeof channelId === "string",
      ) ||
      !Array.isArray(identity.serverIds) ||
      !identity.serverIds.every((serverId) => typeof serverId === "string") ||
      !Array.isArray(identity.friendIds) ||
      !identity.friendIds.every((friendId) => typeof friendId === "string") ||
      typeof identity.exp !== "number" ||
      identity.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return identity;
  } catch {
    return null;
  }
}
