"use client";

import { signIn } from "next-auth/react";
import { useParams } from "next/navigation";
import { useEffect } from "react";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  useEffect(() => {
    void signIn("demo-invite", { token, callbackUrl: "/" });
  }, [token]);
  return (
    <main className="loginPage">
      <p>Opening your LC invitation...</p>
    </main>
  );
}
