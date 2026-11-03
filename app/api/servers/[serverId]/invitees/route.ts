import {
  and,
  asc,
  eq,
  gt,
  ilike,
  isNull,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { db } from "../../../../../db";
import { serverMembers, users } from "../../../../../db/schema";
import { normalizeUserHandle } from "../../../../../user-handle";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId } = await params;
  const [owner] = await db
    .select({ role: serverMembers.role })
    .from(serverMembers)
    .where(
      and(
        eq(serverMembers.serverId, serverId),
        eq(serverMembers.userId, session.user.id),
      ),
    );
  if (owner?.role !== "owner")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const query = normalizeUserHandle(
    new URL(request.url).searchParams.get("q") ?? "",
  );
  if (query.length < 3) return NextResponse.json([]);
  if (query.length > 100)
    return NextResponse.json({ error: "Search is too long" }, { status: 400 });
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      image: users.image,
    })
    .from(users)
    .where(
      and(
        ne(users.role, "demo"),
        isNull(users.disabledAt),
        or(isNull(users.expiresAt), gt(users.expiresAt, new Date())),
        notInArray(
          users.id,
          db
            .select({ userId: serverMembers.userId })
            .from(serverMembers)
            .where(eq(serverMembers.serverId, serverId)),
        ),
        or(ilike(users.name, pattern), ilike(users.handle, pattern)),
      ),
    )
    .orderBy(asc(users.name), asc(users.handle))
    .limit(20);
  return NextResponse.json(rows);
}
