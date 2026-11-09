"use client";
import { useEffect, useRef } from "react";

export function LegalFrame({
  title,
  document,
  onClose,
}: {
  title: string;
  document: "impressum" | "privacy" | "licenses";
  onClose: () => void;
}) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return (
    <iframe
      title={title}
      src={`/${document}`}
      onLoad={(event) => {
        cleanup.current?.();
        const content = event.currentTarget.contentDocument;
        if (!content) return;
        const back = (event: MouseEvent) => {
          const link = (event.target as Element | null)?.closest?.("a");
          if (!link) return;
          const target = new URL(link.href);
          if (
            target.origin !== window.location.origin ||
            target.pathname !== "/"
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        };
        content.addEventListener("click", back, true);
        cleanup.current = () =>
          content.removeEventListener("click", back, true);
      }}
    />
  );
}
