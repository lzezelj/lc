"use client";

import { signIn } from "next-auth/react";
import { LegalLinks } from "../legal-links";

export default function LoginPage() {
  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="workspaceLogo">LC</div>
        <span className="workInProgress">Work in progress</span>
        <h1>Welcome to LC</h1>
        <p>
          LC is an active portfolio project and may change while it is being
          developed.
        </p>
        <p>Owner access is restricted to the configured Google account.</p>
        <button onClick={() => signIn("google", { callbackUrl: "/" })}>
          Continue with Google
        </button>
        <small>Demo participants enter through an invitation link.</small>
        <LegalLinks />
      </section>
    </main>
  );
}
