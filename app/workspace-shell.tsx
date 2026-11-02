"use client";

import type { CSSProperties, ReactNode } from "react";

export function WorkspaceShell({
  children,
  call,
  className,
  style,
}: {
  children: ReactNode;
  call: ReactNode;
  className: string;
  style?: CSSProperties;
}) {
  return (
    <main className={className} style={style}>
      {children}
      <div className="persistentCallLayer" data-lc-persistent-call="">
        {call}
      </div>
    </main>
  );
}
