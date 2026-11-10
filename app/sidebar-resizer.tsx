"use client";

import {
  useEffect,
  useRef,
  type PointerEvent,
  type KeyboardEvent,
} from "react";

export function SidebarResizer({
  onResize,
  onReset,
  side = "channels",
}: {
  onResize: (width: number) => void;
  onReset: () => void;
  side?: "channels" | "members";
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = handle.current;
    if (!element?.parentElement) return;
    const update = () =>
      element.setAttribute(
        "aria-valuenow",
        String(
          Math.round(element.parentElement!.getBoundingClientRect().width),
        ),
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);
  const limits = (element: HTMLElement) => {
    const sidebar = element.parentElement!;
    const other = sidebar.parentElement?.querySelector(
      side === "channels" ? ".memberSidebar" : ".channelSidebar",
    );
    const available =
      window.innerWidth -
      (side === "channels"
        ? sidebar.getBoundingClientRect().left
        : (sidebar.parentElement
            ?.querySelector(".workspaceRail")
            ?.getBoundingClientRect().width ?? 0)) -
      (other?.getBoundingClientRect().width ?? 0) -
      240;
    const min = side === "channels" ? 320 : 240;
    const room =
      side === "members" && window.innerWidth <= 920
        ? window.innerWidth * 0.85
        : available;
    return { min, max: Math.max(min, Math.min(480, room)) };
  };
  const resize = (element: HTMLElement, width: number) => {
    const { min, max } = limits(element);
    const next = Math.round(Math.max(min, Math.min(max, width)));
    element.setAttribute("aria-valuenow", String(next));
    onResize(next);
  };
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.removeAttribute("data-dragging");
  };
  return (
    <div
      ref={handle}
      className={`sidebarResizer ${side === "members" ? "memberSidebarResizer" : ""}`}
      role="separator"
      aria-label={
        side === "members" ? "Resize All users" : "Resize channel list"
      }
      title={`Drag to resize ${side === "members" ? "All users" : "channels"}; double-click to reset`}
      aria-orientation="vertical"
      aria-valuemin={side === "channels" ? 320 : 240}
      aria-valuemax={480}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        drag.current = {
          x: event.clientX,
          width:
            event.currentTarget.parentElement!.getBoundingClientRect().width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.setAttribute("data-dragging", "true");
      }}
      onPointerMove={(event) => {
        if (drag.current)
          resize(
            event.currentTarget,
            drag.current.width +
              (event.clientX - drag.current.x) * (side === "members" ? -1 : 1),
          );
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={(event) => {
        drag.current = null;
        event.currentTarget.removeAttribute("data-dragging");
      }}
      onDoubleClick={onReset}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        event.currentTarget.focus({ preventScroll: true });
        const current =
          event.currentTarget.parentElement!.getBoundingClientRect().width;
        const step = event.shiftKey ? 40 : 10;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          resize(
            event.currentTarget,
            current +
              (event.key === "ArrowLeft" ? -step : step) *
                (side === "members" ? -1 : 1),
          );
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          resize(
            event.currentTarget,
            event.key === "Home" ? (side === "channels" ? 320 : 240) : 480,
          );
        }
      }}
    />
  );
}
