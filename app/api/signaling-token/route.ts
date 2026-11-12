import { NextResponse } from "next/server";
import { auth } from "../../../auth";
import { createSignalingToken } from "../../../server/signaling-auth.mjs";
import { signalingPermissions } from "../../../server/signaling-permissions";
import {
  checkRateLimit,
  rateLimits,
  rateLimitMessage,
} from "../../../server/rate-limit";

export async function POST() {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rateLimit = checkRateLimit(
    `signaling-token:${session.user.id}`,
    rateLimits.signalingToken,
  );
  if (!rateLimit.allowed)
    return NextResponse.json(
      {
        error: rateLimitMessage(
          "Too many connection attempts.",
          rateLimit.retryAfterSeconds,
        ),
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      },
    );
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Signaling authentication is not configured" },
      { status: 503 },
    );
  }
  const identity = await signalingPermissions(session.user.id);
  if (!identity)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json({
    token: createSignalingToken({ ...identity, id: identity.sub }, secret),
  });
}
