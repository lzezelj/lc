import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface User {
    role: "owner" | "member" | "demo";
  }

  interface Session {
    user: {
      id: string;
      role: "owner" | "member" | "demo";
      handle?: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    role: "owner" | "member" | "demo";
    handle?: string;
  }
}
