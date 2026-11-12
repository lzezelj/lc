import { timingSafeEqual } from "node:crypto";
import { signalingPermissions } from "../../../../server/signaling-permissions";

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
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (typeof body?.userId !== "string")
    return Response.json({ error: "Invalid account" }, { status: 400 });
  const identity = await signalingPermissions(body.userId);
  if (!identity) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(identity, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
