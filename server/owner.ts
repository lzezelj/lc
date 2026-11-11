import { auth } from "../auth";
import { matchesOwnerEmail } from "./owner-policy.mjs";

// auth() reloads the account and its email from PostgreSQL on every access.
export async function ownerSession() {
  const session = await auth();
  return session &&
    session.user.role !== "demo" &&
    matchesOwnerEmail(session.user.email, process.env.OWNER_EMAIL)
    ? session
    : null;
}
