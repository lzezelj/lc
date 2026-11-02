"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 2h6v3l2 1 2-1 3 5-2 1v2l2 1-3 5-2-1-2 1v3H9v-3l-2-1-2 1-3-5 2-1v-2l-2-1 3-5 2 1 2-1z" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

export function SettingsModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        (document.activeElement === document.body ||
          element?.contains(document.activeElement))
      )
        previousFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialog}
      className="settingsModal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="settingsClose"
          aria-label="Close settings"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="settingsActions">{children}</div>
    </dialog>,
    document.body,
  );
}
