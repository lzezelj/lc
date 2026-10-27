"use client";

import { SessionProvider } from "next-auth/react";
import { CallMediaProvider } from "./call-media";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus>
      <CallMediaProvider>{children}</CallMediaProvider>
    </SessionProvider>
  );
}
