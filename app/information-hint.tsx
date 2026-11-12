"use client";

import { useEffect, useId, useRef, useState } from "react";

export function InformationHint({ text }: { text: string }) {
  const id = useId();
  const trigger = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false),
    pointerFocus = useRef(false);
  const [open, setOpen] = useState(false);
  function hide() {
    pinned.current = false;
    tooltip.current?.hidePopover();
    setOpen(false);
  }
  function show() {
    const node = tooltip.current,
      anchor = trigger.current?.getBoundingClientRect();
    if (!node || !anchor) return;
    node.showPopover();
    setOpen(true);
    const box = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(anchor.left, innerWidth - box.width - 8))}px`;
    const below = anchor.bottom + 8;
    node.style.top = `${below + box.height <= innerHeight - 8 ? below : Math.max(8, anchor.top - box.height - 8)}px`;
  }
  function toggle() {
    pointerFocus.current = false;
    if (pinned.current) hide();
    else {
      pinned.current = true;
      show();
    }
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);
  return (
    <span
      className="informationHint"
      ref={trigger}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") show();
      }}
      onPointerLeave={() => {
        if (!pinned.current) hide();
      }}
      onPointerDown={() => {
        pointerFocus.current = true;
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle();
      }}
      onFocus={() => {
        if (!pointerFocus.current) show();
      }}
      onBlur={hide}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          toggle();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          hide();
        }
      }}
      tabIndex={0}
      role="button"
      aria-expanded={open}
      aria-label="Information"
      aria-describedby={id}
    >
      <span aria-hidden="true">i</span>
      <span
        ref={tooltip}
        popover="manual"
        id={id}
        role="tooltip"
        className="informationHintOverlay"
      >
        {text}
      </span>
    </span>
  );
}
