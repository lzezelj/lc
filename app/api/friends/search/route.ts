import { and, ilike, isNull, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import { users } from "../../../../db/schema";

export async function GET(request: Request) {
  const session = await auth();
  const query = new URL(request.url).searchParams
    .get("q")
    ?.trim()
    .toLowerCase();
  if (!session || !query || query.length < 2) return NextResponse.json([]);
  const rows = await db
    .select({ id: users.id, name: users.name, handle: users.handle })
    .from(users)
    .where(
      and(
        ne(users.id, session.user.id),
        ilike(users.handle, `%${query}%`),
        isNull(users.disabledAt),
      ),
    )
    .limit(10);
  return NextResponse.json(rows);
}
