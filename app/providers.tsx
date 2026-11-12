"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { CallMediaProvider } from "./call-media";
import { PictureCacheProvider } from "./picture-cache-provider";
function AccountPictures({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  return (
    <PictureCacheProvider accountId={session?.user.id}>
      {children}
    </PictureCacheProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={60} refetchOnWindowFocus>
      <AccountPictures>
        <CallMediaProvider>{children}</CallMediaProvider>
      </AccountPictures>
    </SessionProvider>
  );
}
