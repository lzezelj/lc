import { createHash } from "node:crypto";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, gt, isNull } from "drizzle-orm";
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import {
  isAccountActive,
  isSessionWithinLifetime,
  SESSION_MAX_AGE_SECONDS,
} from "./auth-account.mjs";
import { db } from "./db";
import { ensureUserHandle } from "./server/user-handles";
import {
  accounts,
  demoInvites,
  serverMembers,
  sessions,
  users,
} from "./db/schema";

function normalizedEmails(value: string | undefined) {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

function isOwnerEmail(email: string) {
  return email === process.env.OWNER_EMAIL?.trim().toLowerCase();
}

function isAllowedGoogleEmail(email: string) {
  return (
    isOwnerEmail(email) ||
    normalizedEmails(process.env.ALLOWED_EMAILS).has(email)
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
  }),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
    CredentialsProvider({
      id: "demo-invite",
      name: "Demo invitation",
      credentials: { token: { label: "Invitation token", type: "text" } },
      async authorize(credentials) {
        const token = credentials?.token;
        if (typeof token !== "string" || !token) return null;
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const [invite] = await db
          .update(demoInvites)
          .set({ redeemedAt: new Date() })
          .where(
            and(
              eq(demoInvites.tokenHash, tokenHash),
              isNull(demoInvites.redeemedAt),
              isNull(demoInvites.revokedAt),
              gt(demoInvites.expiresAt, new Date()),
            ),
          )
          .returning({ demoUserId: demoInvites.demoUserId });
        if (!invite) return null;
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, invite.demoUserId));
        if (
          !user ||
          user.disabledAt ||
          (user.expiresAt && user.expiresAt < new Date())
        )
          return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile, user }) {
      if (account?.provider !== "google") return true;
      const googleProfile = profile as {
        email?: string;
        email_verified?: boolean;
      };
      const email = googleProfile.email?.trim().toLowerCase();
      if (
        !googleProfile.email_verified ||
        !email ||
        !isAllowedGoogleEmail(email)
      ) {
        return false;
      }
      if (!user.id) return false;
      const role = isOwnerEmail(email) ? "owner" : "member";
      user.role = role;
      return true;
    },
    async jwt({ token, user, account }) {
      if (user?.id) {
        token.userId = user.id;
        token.role =
          account?.provider === "google"
            ? isOwnerEmail(user.email?.trim().toLowerCase() ?? "")
              ? "owner"
              : "member"
            : user.role;
        token.handle = await ensureUserHandle(user.id, user.name);
        if (account?.provider === "google") {
          await db
            .update(users)
            .set({ role: token.role, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
        return token;
      }

      if (!token.userId || !isSessionWithinLifetime(token.iat)) return null;
      const [currentUser] = await db
        .select({
          id: users.id,
          role: users.role,
          disabledAt: users.disabledAt,
          expiresAt: users.expiresAt,
          handle: users.handle,
          name: users.name,
        })
        .from(users)
        .where(eq(users.id, token.userId));
      if (!isAccountActive(currentUser)) {
        if (currentUser?.role === "demo") {
          await db
            .delete(serverMembers)
            .where(eq(serverMembers.userId, currentUser.id));
        }
        return null;
      }
      token.role = currentUser.role;
      token.handle =
        currentUser.handle ??
        (await ensureUserHandle(currentUser.id, currentUser.name));
      token.name = currentUser.name;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.role = token.role;
        session.user.handle = token.handle;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
});
