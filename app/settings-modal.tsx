"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { revealSettingsSection } from "./settings-reveal";

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
  navigation,
  className = "",
  closeLabel,
  movable = false,
  layers,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  navigation?: ReactNode;
  className?: string;
  closeLabel?: string;
  movable?: boolean;
  layers?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const moveTo = useCallback((left: number, top: number) => {
    const element = dialog.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty(
      "--dialog-left",
      `${Math.max(12, Math.min(left, innerWidth - rect.width - 12))}px`,
    );
    element.style.setProperty(
      "--dialog-top",
      `${Math.max(12, Math.min(top, innerHeight - Math.min(rect.height, innerHeight - 24) - 12))}px`,
    );
  }, []);
  useEffect(() => {
    if (!movable) return;
    const clamp = () => {
      const rect = dialog.current?.getBoundingClientRect();
      if (rect) moveTo(rect.left, rect.top);
    };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, [movable, moveTo]);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    element?.showModal();
    const reveal = (event: Event) => {
      if (
        event.target instanceof HTMLDetailsElement &&
        event.target.open &&
        event.target.contains(document.activeElement)
      )
        revealSettingsSection(event.target);
    };
    element?.addEventListener("toggle", reveal, true);
    return () => {
      element?.removeEventListener("toggle", reveal, true);
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

  const content = (
    <>
      <header
        tabIndex={movable ? 0 : undefined}
        aria-label={
          movable ? `Move ${title} window. Drag or use arrow keys.` : undefined
        }
        onKeyDown={(event) => {
          if (
            !movable ||
            event.target !== event.currentTarget ||
            !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
              event.key,
            )
          )
            return;
          event.preventDefault();
          const rect = dialog.current!.getBoundingClientRect();
          const amount = event.shiftKey ? 40 : 10;
          moveTo(
            rect.left +
              (event.key === "ArrowRight"
                ? amount
                : event.key === "ArrowLeft"
                  ? -amount
                  : 0),
            rect.top +
              (event.key === "ArrowDown"
                ? amount
                : event.key === "ArrowUp"
                  ? -amount
                  : 0),
          );
        }}
        onPointerDown={(event) => {
          if (
            !movable ||
            event.button !== 0 ||
            (event.target as Element).closest("button")
          )
            return;
          event.preventDefault();
          const rect = dialog.current!.getBoundingClientRect();
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: rect.left,
            top: rect.top,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.setAttribute("data-dragging", "true");
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current && current.pointer === event.pointerId)
            moveTo(
              current.left + event.clientX - current.x,
              current.top + event.clientY - current.y,
            );
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.removeAttribute("data-dragging");
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          drag.current = null;
          event.currentTarget.removeAttribute("data-dragging");
        }}
        onLostPointerCapture={(event) => {
          drag.current = null;
          event.currentTarget.removeAttribute("data-dragging");
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {movable && <small className="modalDragHint">Drag to move</small>}
        <button
          type="button"
          className="settingsClose"
          aria-label={
            closeLabel ??
            (title === "User profile" ? "Close profile" : "Close settings")
          }
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {navigation ? (
        <div className="settingsLayout">
          <nav className="settingsNavigation" aria-label={`${title} sections`}>
            {navigation}
          </nav>
          <div className="settingsContent">{children}</div>
        </div>
      ) : (
        <div className="settingsActions">{children}</div>
      )}
    </>
  );
  return createPortal(
    <dialog
      ref={dialog}
      className={`settingsModal ${navigation ? "settingsWorkspace" : ""} ${className}`}
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
      {layers}
      {movable ? (
        <div className="settingsModalSurface">{content}</div>
      ) : (
        content
      )}
    </dialog>,
    document.body,
  );
}

export function SettingsNameForm({
  name,
  label,
  onSave,
}: {
  name: string;
  label: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="settingsNameForm"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
          await onSave(value);
        } catch {
          setError("Changes could not be saved. Please try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <label>
        {label}
        <input
          value={value}
          maxLength={60}
          required
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        className="primary"
        disabled={saving || !value.trim() || value.trim() === name}
        type="submit"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
