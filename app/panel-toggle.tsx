"use client";

import { useCallback, useSyncExternalStore, type ReactNode } from "react";

export function PanelToggle({
  label,
  toggled,
  defaultHiddenBelow = 0,
  onToggle,
  children,
}: {
  label: string;
  toggled: boolean;
  defaultHiddenBelow?: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  const query = `(max-width: ${defaultHiddenBelow}px)`;
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const hiddenByDefault = useSyncExternalStore(
    subscribe,
    snapshot,
    () => false,
  );
  const open = hiddenByDefault ? toggled : !toggled;
  const action = `${open ? "Hide" : "Show"} ${label}`;
  return (
    <button
      type="button"
      title={action}
      aria-label={action}
      aria-expanded={open}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}
