import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { removeAccountGroupMedia } from "../../../../server/voice-sessions.mjs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret =
    process.env.SIGNALING_INTERNAL_SECRET ?? process.env.AUTH_SECRET;
  const supplied = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "");
  if (
    !secret ||
    !supplied ||
    Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (
    typeof body?.userId !== "string" ||
    !body.userId ||
    body.userId.length > 200
  )
    return NextResponse.json({ error: "Invalid account" }, { status: 400 });
  if (
    body.keepSessionId !== undefined &&
    (typeof body.keepSessionId !== "string" ||
      !body.keepSessionId ||
      body.keepSessionId.length > 200)
  )
    return NextResponse.json(
      { error: "Invalid voice session" },
      { status: 400 },
    );
  try {
    await removeAccountGroupMedia(body.userId, body.keepSessionId);
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json(
      { error: "Could not transfer group media" },
      { status: 503 },
    );
  }
}
