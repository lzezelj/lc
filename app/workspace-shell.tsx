"use client";

import type { CSSProperties, ReactNode } from "react";

export function WorkspaceShell({
  children,
  call,
  className,
  style,
  help,
}: {
  children: ReactNode;
  call: ReactNode;
  className: string;
  style?: CSSProperties;
  help?: ReactNode;
}) {
  return (
    <main className={className} style={style}>
      {children}
      <div className="persistentCallLayer" data-lc-persistent-call="">
        {call}
      </div>
      {help}
    </main>
  );
}
