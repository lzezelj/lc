import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "../../../auth";

const STUN_SERVER = { urls: "stun:stun.l.google.com:19302" };

export async function GET() {
  const session = await auth();
  if (!session?.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.TURN_SECRET;
  const urls = process.env.TURN_URLS?.split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (!secret || !urls?.length) {
    return NextResponse.json({ iceServers: [STUN_SERVER], expiresAt: null });
  }

  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = `${expiresAt}:${session.user.id}`;
  const credential = createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  return NextResponse.json({
    iceServers: [STUN_SERVER, { urls, username, credential }],
    expiresAt,
  });
}
