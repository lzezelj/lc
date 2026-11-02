"use client";

import { useEffect, useRef, useState } from "react";

export type UserStatus = "online" | "away" | "dnd" | "invisible";
export const statusLabels: Record<UserStatus, string> = {
  online: "Online",
  away: "Away",
  dnd: "Do not disturb",
  invisible: "Invisible",
};
export function isUserStatus(value: unknown): value is UserStatus {
  return (
    value === "online" ||
    value === "away" ||
    value === "dnd" ||
    value === "invisible"
  );
}
export function readUserStatus(): UserStatus {
  const value =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem("lc.userStatus");
  return isUserStatus(value) ? value : "online";
}

export function UserStatusMenu({
  name,
  status,
  speaking,
  onChange,
}: {
  name: string;
  status: UserStatus;
  speaking: boolean;
  onChange: (status: UserStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, bottom: 80 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"][aria-checked="true"]',
      )
      ?.focus();
    const close = (event: Event) => {
      if (
        event.type === "pointerdown" &&
        root.current?.contains(event.target as Node)
      )
        return;
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setOpen(false);
      if (event instanceof KeyboardEvent) trigger.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <div className="profileStatusMenu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`profileIdentity profileStatusTrigger ${speaking ? "speaking" : ""}`}
        aria-label={`${name}, ${statusLabels[status]}. Change status`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect)
            setPosition({
              left: Math.max(16, Math.min(rect.left, window.innerWidth - 272)),
              bottom: window.innerHeight - rect.top + 8,
            });
          setOpen((current) => !current);
        }}
      >
        <span className="avatar" aria-hidden="true">
          {name[0]?.toUpperCase() ?? "Y"}
        </span>
        <span className="profileStatusName">
          <strong title={name}>{name}</strong>
          <small className="statusText" title={statusLabels[status]}>
            <i className={`statusDot status-${status}`} aria-hidden="true" />
            <span>{statusLabels[status]}</span>
          </small>
        </span>
      </button>
      {open && (
        <div
          className="userStatusDropdown"
          role="menu"
          aria-label="User status"
          style={position}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button[role="menuitemradio"]',
              ),
            ];
            const current = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            items[
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : (current +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      items.length) %
                    items.length
            ]?.focus();
          }}
        >
          {(Object.keys(statusLabels) as UserStatus[]).map((choice) => (
            <button
              key={choice}
              role="menuitemradio"
              aria-checked={status === choice}
              onClick={() => {
                onChange(choice);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <i className={`statusDot status-${choice}`} aria-hidden="true" />
              <span>
                <strong>{statusLabels[choice]}</strong>
                <small>
                  {choice === "dnd"
                    ? "Silence incoming ringtones"
                    : choice === "invisible"
                      ? "Appear offline; calls and messages still work"
                      : choice === "away"
                        ? "Away from keyboard"
                        : "Available"}
                </small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
