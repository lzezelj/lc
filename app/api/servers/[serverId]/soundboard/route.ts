import { and, asc, count, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { serverMembers, serverSounds, servers } from "../../../../../db/schema";
import {
  maxServerSounds,
  readSoundBody,
  validateSoundWave,
} from "../../../../../server/sound-upload";
import { checkRateLimit } from "../../../../../server/rate-limit";
import { notifyServer } from "../../../../../server/notify-server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const metadata = {
  id: serverSounds.id,
  name: serverSounds.name,
  serverId: serverSounds.serverId,
  durationMs: serverSounds.durationMs,
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      serverId,
    )
  )
    return NextResponse.json({ error: "Invalid server" }, { status: 400 });
  const [member] = await db
    .select()
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.userId, session.user.id),
        eq(serverMembers.serverId, serverId),
      ),
    );
  if (!member)
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const clip = new URL(request.url).searchParams.get("clip");
  const headers = { "Cache-Control": "private, no-store" };
  if (clip !== null) {
    let audio: Uint8Array | null = null;
    if (uuid.test(clip)) {
      const [stored] = await db
        .select({ audio: serverSounds.audio })
        .from(serverSounds)
        .where(
          and(eq(serverSounds.id, clip), eq(serverSounds.serverId, serverId)),
        );
      if (stored) audio = new Uint8Array(stored.audio);
    }
    if (!audio)
      return NextResponse.json({ error: "Sound not found" }, { status: 404 });
    return new Response(new Uint8Array(audio), {
      headers: {
        ...headers,
        "Content-Type": "audio/wav",
        "Content-Length": String(audio.length),
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return NextResponse.json(
    {
      sounds: [
        ...(
          await db
            .select(metadata)
            .from(serverSounds)
            .where(eq(serverSounds.serverId, serverId))
            .orderBy(asc(serverSounds.createdAt), asc(serverSounds.id))
        ).map((sound) => ({ ...sound, custom: true })),
      ],
      canManage: member.role === "owner",
      canUpload: member.role === "owner" || member.role === "mod",
    },
    { headers },
  );
}

async function authorizeMutation(serverId: string, allowModerator = false) {
  const session = await auth();
  if (!session)
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  if (!uuid.test(serverId))
    return {
      error: NextResponse.json({ error: "Invalid server" }, { status: 400 }),
    };
  const [member] = await db
    .select()
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.userId, session.user.id),
        eq(serverMembers.serverId, serverId),
      ),
    );
  if (member?.role !== "owner" && !(allowModerator && member?.role === "mod"))
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  const limit = checkRateLimit(`soundboard:${session.user.id}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed)
    return {
      error: NextResponse.json(
        { error: "Too many soundboard changes. Try again shortly." },
        {
          status: 429,
          headers: { "Retry-After": String(limit.retryAfterSeconds) },
        },
      ),
    };
  return { userId: session.user.id };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const { serverId } = await params;
  const access = await authorizeMutation(serverId, true);
  if (access.error) return access.error;
  const name = new URL(request.url).searchParams.get("name")?.trim();
  if (!name || name.length > 60)
    return NextResponse.json(
      { error: "Sound name must be 1–60 characters" },
      { status: 400 },
    );
  if (
    !["audio/wav", "audio/x-wav", "audio/wave"].includes(
      request.headers.get("content-type")?.split(";")[0] ?? "",
    )
  )
    return NextResponse.json(
      { error: "Upload a 16-bit PCM WAV file" },
      { status: 415 },
    );
  const bytes = await readSoundBody(request).catch(() => null);
  if (!bytes)
    return NextResponse.json(
      { error: "Sound must be at most 2 MiB" },
      { status: 413 },
    );
  const valid = validateSoundWave(bytes);
  if (!valid)
    return NextResponse.json(
      {
        error:
          "Use a valid 16-bit PCM WAV, mono or stereo, 8–48 kHz, up to 10.01 seconds",
      },
      { status: 400 },
    );
  return db.transaction(async (tx) => {
    // All uploaders share this lock; individual member locks cannot protect the quota.
    const [server] = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, serverId))
      .for("update");
    if (!server)
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    const [owner] = await tx
      .select()
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.userId, access.userId!),
          eq(serverMembers.serverId, serverId),
        ),
      )
      .for("update");
    if (owner?.role !== "owner" && owner?.role !== "mod")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [total] = await tx
      .select({ value: count() })
      .from(serverSounds)
      .where(eq(serverSounds.serverId, serverId));
    if (total.value >= maxServerSounds)
      return NextResponse.json(
        { error: `This server already has ${maxServerSounds} custom sounds` },
        { status: 409 },
      );
    const [sound] = await tx
      .insert(serverSounds)
      .values({
        serverId,
        name,
        audio: Buffer.from(bytes),
        durationMs: valid.durationMs,
      })
      .returning(metadata);
    return NextResponse.json({ ...sound, custom: true }, { status: 201 });
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const { serverId } = await params;
  const access = await authorizeMutation(serverId);
  if (access.error) return access.error;
  const clip = new URL(request.url).searchParams.get("clip") ?? "";
  if (!uuid.test(clip))
    return NextResponse.json(
      { error: "Invalid custom sound" },
      { status: 400 },
    );
  const response = await db.transaction(async (tx) => {
    const [server] = await tx
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, serverId))
      .for("update");
    if (!server)
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    const [owner] = await tx
      .select()
      .from(serverMembers)
      .where(
        and(
          eq(serverMembers.userId, access.userId!),
          eq(serverMembers.serverId, serverId),
        ),
      )
      .for("update");
    if (owner?.role !== "owner")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const [removed] = await tx
      .delete(serverSounds)
      .where(
        and(eq(serverSounds.id, clip), eq(serverSounds.serverId, serverId)),
      )
      .returning({ id: serverSounds.id });
    return removed
      ? NextResponse.json(removed)
      : NextResponse.json({ error: "Sound not found" }, { status: 404 });
  });
  if (response.ok) void notifyServer(serverId);
  return response;
}
