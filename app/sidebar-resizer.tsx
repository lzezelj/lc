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
}: {
  onResize: (width: number) => void;
  onReset: () => void;
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
    const members = sidebar.parentElement?.querySelector(".memberSidebar");
    const available =
      window.innerWidth -
      sidebar.getBoundingClientRect().left -
      (members?.getBoundingClientRect().width ?? 0) -
      240;
    return { min: 240, max: Math.max(240, Math.min(480, available)) };
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
      className="sidebarResizer"
      role="separator"
      aria-label="Resize channel list"
      title="Drag to resize channels; double-click to reset"
      aria-orientation="vertical"
      aria-valuemin={240}
      aria-valuemax={480}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
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
            drag.current.width + event.clientX - drag.current.x,
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
        const current =
          event.currentTarget.parentElement!.getBoundingClientRect().width;
        const step = event.shiftKey ? 40 : 10;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          resize(
            event.currentTarget,
            current + (event.key === "ArrowLeft" ? -step : step),
          );
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          resize(event.currentTarget, event.key === "Home" ? 240 : 480);
        }
      }}
    />
  );
}
