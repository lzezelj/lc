"use client";

import { signIn } from "next-auth/react";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="workspaceLogo">LC</div>
        <h1>Welcome to LC</h1>
        <p>Owner access is restricted to the configured Google account.</p>
        <button onClick={() => signIn("google", { callbackUrl: "/" })}>
          Continue with Google
        </button>
        <small>Demo participants enter through an invitation link.</small>
      </section>
    </main>
  );
}
