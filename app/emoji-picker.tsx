"use client";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { emojiCatalog } from "./emoji-catalog";

export function EmojiPicker({
  onSelect,
  label = "Add emoji",
  disabled = false,
  menuItem = false,
}: {
  onSelect: (emoji: string) => void;
  label?: string;
  disabled?: boolean;
  menuItem?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const host = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusOnOpen = useRef(true);
  const id = useId();
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const leave = (event: React.PointerEvent) => {
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      (host.current?.contains(next) || panel.current?.contains(next))
    )
      return;
    keepOpen();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  const show = (focus: boolean) => {
    if (disabled) return;
    keepOpen();
    const rect = trigger.current!.getBoundingClientRect();
    const width = Math.min(288, innerWidth - 16);
    setPosition({
      left: menuItem
        ? Math.max(
            8,
            Math.min(
              rect.right + 6 + width <= innerWidth - 8
                ? rect.right + 6
                : rect.left - width - 6,
              innerWidth - width - 8,
            ),
          )
        : Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
      top: Math.max(
        8,
        Math.min(
          menuItem
            ? rect.top
            : rect.top > 336
              ? rect.top - 328
              : rect.bottom + 6,
          innerHeight - 328,
        ),
      ),
    });
    focusOnOpen.current = focus;
    if (!open) setQuery("");
    setOpen(true);
    if (focus && open) search.current?.focus();
  };
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    if (focusOnOpen.current) search.current?.focus();
    const close = (event: PointerEvent) => {
      if (
        !host.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const choices = emojiCatalog.filter(([emoji, name]) =>
    `${emoji} ${name}`.includes(query.trim().toLowerCase()),
  );
  return (
    <div
      className={`emojiPicker ${menuItem ? "emojiMenuItem" : ""}`}
      ref={host}
      onPointerEnter={menuItem ? keepOpen : undefined}
      onPointerLeave={menuItem ? leave : undefined}
      onKeyDown={(event) => {
        if (
          menuItem &&
          event.key === "ArrowRight" &&
          event.target === trigger.current
        ) {
          event.preventDefault();
          show(true);
        }
        if (
          menuItem &&
          event.key === "ArrowLeft" &&
          open &&
          event.target !== search.current
        ) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className={menuItem ? "reactionMenuTrigger" : "emojiTrigger"}
        role={menuItem ? "menuitem" : undefined}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onPointerEnter={
          menuItem
            ? (event) => {
                if (event.pointerType !== "touch") show(false);
              }
            : undefined
        }
        onClick={() => {
          if (open && !menuItem) setOpen(false);
          else show(true);
        }}
      >
        {menuItem ? (
          <>
            <span>{label}</span>
            <svg
              className="reactionMenuArrow"
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </>
        ) : (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M8 14a4 4 0 0 0 8 0" />
            <path d="M8.5 8.5h.01M15.5 8.5h.01" strokeWidth="2.8" />
          </svg>
        )}
      </button>
      {open &&
        !disabled &&
        createPortal(
          <section
            ref={panel}
            id={id}
            style={position}
            className="emojiPopover"
            role="dialog"
            aria-label="Choose an emoji"
            onPointerEnter={menuItem ? keepOpen : undefined}
            onPointerLeave={menuItem ? leave : undefined}
          >
            <input
              ref={search}
              type="search"
              aria-label="Search emojis"
              placeholder="Search emojis"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="emojiGrid">
              {choices.map(([emoji, name]) => (
                <button
                  type="button"
                  key={emoji}
                  aria-label={`${emoji} ${name}`}
                  title={name}
                  onClick={() => {
                    setOpen(false);
                    trigger.current?.focus();
                    onSelect(emoji);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {!choices.length && <p>No matching emojis.</p>}
          </section>,
          document.body,
        )}
    </div>
  );
}
