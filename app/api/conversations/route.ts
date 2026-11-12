import { auth } from "../../../auth";
import {
  canMessage,
  conversationPeers,
} from "../../../server/direct-conversations";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  return Response.json(await conversationPeers(session.user.id), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const body = await request.json().catch(() => null);
  if (
    !session ||
    typeof body?.userId !== "string" ||
    !(await canMessage(session.user.id, body.userId))
  )
    return Response.json(
      {
        error:
          "You can start a conversation with someone who shares a server with you.",
      },
      { status: 403 },
    );
  const [peer] = await conversationPeers(session.user.id, body.userId);
  if (!peer)
    return Response.json(
      { error: "Conversation unavailable" },
      { status: 404 },
    );
  return Response.json(peer);
}
