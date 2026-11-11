import { ownerSession } from "../../../server/owner";
import { readAdmin } from "../../../server/admin-read";
import { mutateAdmin } from "../../../server/admin-mutations";
import { checkRateLimit, rateLimits } from "../../../server/rate-limit";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!(await ownerSession()))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  return readAdmin(new URL(request.url).searchParams);
}
async function mutate(request: Request) {
  const session = await ownerSession();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const limit = checkRateLimit(
    `admin-mutation:${session.user.id}`,
    rateLimits.adminMutation,
  );
  if (!limit.allowed)
    return Response.json(
      { error: "Too many admin changes. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  return mutateAdmin(request, session.user.id);
}
export { mutate as POST, mutate as PATCH, mutate as DELETE };
