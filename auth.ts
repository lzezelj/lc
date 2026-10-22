import { createHash } from "node:crypto";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, gt, isNull } from "drizzle-orm";
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import { isAccountActive } from "./auth-account.mjs";
import { db } from "./db";
import { accounts, demoInvites, sessions, users } from "./db/schema";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
  }),
  session: { strategy: "jwt" },
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
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const googleProfile = profile as {
        email?: string;
        email_verified?: boolean;
      };
      return Boolean(
        googleProfile.email_verified &&
        googleProfile.email?.toLowerCase() ===
          process.env.OWNER_EMAIL?.toLowerCase(),
      );
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        token.role = user.role;
        return token;
      }

      if (!token.userId) return null;
      const [currentUser] = await db
        .select({
          id: users.id,
          role: users.role,
          disabledAt: users.disabledAt,
          expiresAt: users.expiresAt,
        })
        .from(users)
        .where(eq(users.id, token.userId));
      if (!isAccountActive(currentUser)) {
        return null;
      }
      token.role = currentUser.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId;
        session.user.role = token.role;
      }
      return session;
    },
  },
  pages: { signIn: "/login" },
});
