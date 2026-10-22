import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { db } from "../../../../db";
import { users } from "../../../../db/schema";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name || name.length > 60)
    return NextResponse.json(
      { error: "Username must be 1-60 characters" },
      { status: 400 },
    );
  const [user] = await db
    .update(users)
    .set({ name, updatedAt: new Date() })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id, name: users.name });
  return NextResponse.json(user);
}
