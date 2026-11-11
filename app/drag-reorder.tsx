"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from "react";
import { moveRelative, type DropPlacement } from "../lib/list-order";

type Item = { id: string; name: string; group?: string };
type Options = {
  items: readonly Item[];
  scope: string;
  enabled?: boolean;
  onReorder: (
    id: string,
    targetId: string,
    placement: DropPlacement,
  ) => Promise<void>;
};
type Drag = {
  boxes: Map<string, DOMRect>;
  originY: number;
  scrollParent: HTMLElement | null;
  scrollTop: number;
  maxScroll: number;
  id: string;
  group?: string;
  scope: string;
  snapshot: string;
  targetId: string;
  placement: DropPlacement;
  keyboard: boolean;
  started: boolean;
  x: number;
  y: number;
  pointerId?: number;
  handle?: HTMLElement;
  destination: number;
};

export function useDragReorder(options: Options) {
  const listId = useId(),
    instructionsId = useId();
  const latest = useRef(options),
    active = useRef<Drag | null>(null);
  const frame = useRef(0),
    busyRef = useRef(false),
    mounted = useRef(true),
    suppressUntil = useRef(0);
  const settling = useRef<Map<string, DOMRect> | null>(null);
  const settlingOrder = useRef("");
  const settlingScope = useRef("");
  const focusAfterDrop = useRef<{ id: string; scope: string } | null>(null);
  const animations = useRef<Animation[]>([]);
  const [view, setView] = useState<Drag | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    latest.current = options;
  });
  const signature = options.items
    .map((item) => `${item.id}:${item.group ?? ""}`)
    .join("|");
  function groupItems(group?: string) {
    return latest.current.items.filter((item) => item.group === group);
  }
  function valid(drag: Drag) {
    return (
      latest.current.enabled !== false &&
      latest.current.scope === drag.scope &&
      groupItems(drag.group)
        .map((item) => item.id)
        .join("|") === drag.snapshot
    );
  }
  function findRow(id: string) {
    return Array.from(
      document.querySelectorAll<HTMLElement>("[data-reorder-list]"),
    ).find(
      (node) =>
        node.dataset.reorderList === listId && node.dataset.reorderId === id,
    );
  }
  function visibleRows() {
    return Array.from(
      document.querySelectorAll<HTMLElement>("[data-reorder-list]"),
    ).filter((node) => node.dataset.reorderList === listId);
  }
  function measure() {
    return new Map(
      visibleRows().map((node) => [
        node.dataset.reorderId!,
        node.getBoundingClientRect(),
      ]),
    );
  }
  function settle(from: Map<string, DOMRect> | null) {
    animations.current.forEach((animation) => animation.cancel());
    animations.current = [];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const nodes = visibleRows();
    const scrollPositions = new Map<HTMLElement, number>();
    for (const node of nodes) {
      let parent = node.parentElement;
      while (parent && !scrollPositions.has(parent)) {
        scrollPositions.set(parent, parent.scrollTop);
        parent = parent.parentElement;
      }
    }
    // Clear the whole preview before measuring any final row. Mixing transformed
    // and committed geometry can trigger scroll anchoring and replay the list.
    for (const node of nodes) {
      node.style.transition = "none";
      node.style.removeProperty("--reorder-offset");
    }
    for (const [parent, top] of scrollPositions) parent.scrollTop = top;
    const finalBoxes = measure();
    for (const node of nodes) {
      const after = finalBoxes.get(node.dataset.reorderId!)!,
        before = from?.get(node.dataset.reorderId!);
      node.style.removeProperty("transition");
      if (!reduced && before && Math.abs(before.top - after.top) > 0.5) {
        node.dataset.reorderSettling = "true";
        const animation = node.animate(
          [
            { translate: `0 ${before.top - after.top}px` },
            { translate: "0 0" },
          ],
          { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
        animations.current.push(animation);
        const clear = () => {
          delete node.dataset.reorderSettling;
        };
        void animation.finished.then(clear, clear);
      }
    }
  }
  useLayoutEffect(() => {
    if (
      settling.current &&
      !(
        busy &&
        signature === settlingOrder.current &&
        options.scope === settlingScope.current
      )
    ) {
      settle(
        options.scope !== settlingScope.current
          ? null
          : signature === settlingOrder.current
            ? measure()
            : settling.current,
      );
      settling.current = null;
    }
    if (!busy && focusAfterDrop.current) {
      if (focusAfterDrop.current.scope === options.scope)
        findRow(focusAfterDrop.current.id)
          ?.querySelector<HTMLElement>(
            "[data-reorder-handle], [data-reorder-icon]",
          )
          ?.focus({ preventScroll: true });
      focusAfterDrop.current = null;
    }
    // Settle only this drop, after React commits the order (or a failed save).
    // Ordinary refreshes must not animate from stale viewport measurements.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, options.scope, busy]);
  function preview(drag: Drag) {
    const rows = groupItems(drag.group).filter((row) => drag.boxes.has(row.id));
    const ordered = moveRelative(rows, drag.id, drag.targetId, drag.placement);
    const first = drag.boxes.get(rows[0]?.id);
    if (!first) return;
    const last = drag.boxes.get(rows.at(-1)!.id)!;
    const gap =
      rows.length > 1
        ? Math.max(0, drag.boxes.get(rows[1].id)!.top - first.bottom)
        : 0;
    let top = first.top;
    for (const row of ordered) {
      const box = drag.boxes.get(row.id)!;
      const offset =
        row.id === drag.id && !drag.keyboard
          ? Math.max(
              first.top - box.top,
              Math.min(
                last.bottom - box.bottom,
                drag.y -
                  drag.originY +
                  (drag.scrollParent?.scrollTop ?? 0) -
                  drag.scrollTop,
              ),
            )
          : top - box.top;
      findRow(row.id)?.style.setProperty("--reorder-offset", `${offset}px`);
      top += box.height + gap;
    }
  }
  function release() {
    const drag = active.current;
    active.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (
      drag?.pointerId !== undefined &&
      drag.handle?.hasPointerCapture(drag.pointerId)
    )
      drag.handle.releasePointerCapture(drag.pointerId);
    return drag;
  }
  function cancel() {
    if (active.current?.started && !active.current.keyboard)
      suppressUntil.current = Date.now() + 500;
    const boxes = measure();
    release();
    settle(boxes);
    settling.current = null;
    setView(null);
    setAnnouncement("Move canceled.");
  }
  useEffect(() => {
    if (active.current && !valid(active.current)) cancel();
    // The signature covers remote reordering, deletion, and permission/scope changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, options.scope, options.enabled]);
  useEffect(() => {
    mounted.current = true;
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", escape);
    return () => {
      mounted.current = false;
      release();
      animations.current.forEach((animation) => animation.cancel());
      window.removeEventListener("keydown", escape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function pickup(id: string, keyboard: boolean, x = 0, y = 0) {
    const item = latest.current.items.find((row) => row.id === id);
    if (
      !item ||
      active.current ||
      busyRef.current ||
      latest.current.enabled === false
    )
      return null;
    const group = groupItems(item.group);
    if (group.length < 2) return null;
    animations.current.forEach((animation) => animation.cancel());
    let scrollParent = findRow(id)?.parentElement ?? null;
    while (
      scrollParent &&
      !/auto|scroll/.test(getComputedStyle(scrollParent).overflowY)
    )
      scrollParent = scrollParent.parentElement;
    const drag: Drag = {
      boxes: measure(),
      originY: y,
      scrollParent,
      scrollTop: scrollParent?.scrollTop ?? 0,
      maxScroll: scrollParent
        ? Math.max(0, scrollParent.scrollHeight - scrollParent.clientHeight)
        : 0,
      id,
      group: item.group,
      scope: latest.current.scope,
      snapshot: group.map((row) => row.id).join("|"),
      targetId: id,
      placement: "before",
      keyboard,
      started: keyboard,
      x,
      y,
      destination: group.findIndex((row) => row.id === id),
    };
    active.current = drag;
    setError("");
    if (keyboard) {
      setView({ ...drag });
      setAnnouncement(
        `${item.name} picked up. Use arrow keys to choose a position, Space to drop, Escape to cancel.`,
      );
    }
    return drag;
  }
  function locate(drag: Drag) {
    const rows = groupItems(drag.group).filter((row) => drag.boxes.has(row.id));
    const first = drag.boxes.get(rows[0]?.id),
      last = drag.boxes.get(rows.at(-1)?.id ?? "");
    const scrollDelta = (drag.scrollParent?.scrollTop ?? 0) - drag.scrollTop;
    const y = drag.y + scrollDelta;
    const bounds = drag.scrollParent?.getBoundingClientRect();
    drag.targetId = "";
    if (
      first &&
      last &&
      drag.x >= Math.max(first.left, bounds?.left ?? first.left) &&
      drag.x <= Math.min(first.right, bounds?.right ?? first.right)
    ) {
      const target =
        bounds && drag.y < bounds.top
          ? rows[0]
          : bounds && drag.y > bounds.bottom
            ? rows.at(-1)!
            : (rows.find((row) => {
                const box = drag.boxes.get(row.id)!;
                return y < box.top + box.height / 2;
              }) ?? rows.at(-1)!);
      const box = drag.boxes.get(target.id)!;
      drag.targetId = target.id;
      drag.placement =
        bounds && drag.y < bounds.top
          ? "before"
          : bounds && drag.y > bounds.bottom
            ? "after"
            : y < box.top + box.height / 2
              ? "before"
              : "after";
    }
    preview(drag);
    setView((previous) =>
      previous?.id === drag.id &&
      previous.targetId === drag.targetId &&
      previous.placement === drag.placement
        ? previous
        : { ...drag },
    );
  }
  function scroll() {
    const drag = active.current;
    if (!drag || drag.keyboard || !drag.started) return;
    if (!valid(drag) || !findRow(drag.id)?.isConnected) {
      cancel();
      return;
    }
    let parent = findRow(drag.id)?.parentElement;
    while (parent && !/auto|scroll/.test(getComputedStyle(parent).overflowY))
      parent = parent.parentElement;
    if (parent) {
      const bounds = parent.getBoundingClientRect();
      if (
        drag.x >= bounds.left &&
        drag.x <= bounds.right &&
        drag.y >= bounds.top - 32 &&
        drag.y <= bounds.bottom + 32
      ) {
        const delta =
          drag.y < bounds.top + 32 ? -10 : drag.y > bounds.bottom - 32 ? 10 : 0;
        parent.scrollTop = Math.max(
          0,
          Math.min(drag.maxScroll, parent.scrollTop + delta),
        );
      }
    }
    locate(drag);
    frame.current = requestAnimationFrame(scroll);
  }
  async function finish() {
    const drag = active.current;
    if (
      !drag ||
      !valid(drag) ||
      !drag.started ||
      !drag.targetId ||
      drag.targetId === drag.id
    ) {
      cancel();
      return;
    }
    // Neighbors already slide to their final slots during preview. Replaying
    // release-time measurements after the save would move them backward.
    // Only the lifted row needs a landing animation on a successful commit.
    const sourceBox = findRow(drag.id)?.getBoundingClientRect();
    settling.current = sourceBox ? new Map([[drag.id, sourceBox]]) : new Map();
    settlingOrder.current = signature;
    settlingScope.current = drag.scope;
    focusAfterDrop.current = drag.keyboard
      ? { id: drag.id, scope: drag.scope }
      : null;
    release();
    setView(null);
    suppressUntil.current = Date.now() + 500;
    busyRef.current = true;
    setBusy(true);
    try {
      await latest.current.onReorder(drag.id, drag.targetId, drag.placement);
      if (mounted.current) setAnnouncement("Order saved.");
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error ? failure.message : "Could not save order.",
        );
    } finally {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
      }
    }
  }
  function pointerProps(id: string, touchIcon = false) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (
          event.button !== 0 ||
          (event.pointerType === "touch" &&
            !touchIcon &&
            !event.currentTarget.hasAttribute("data-reorder-handle"))
        )
          return;
        const drag = pickup(id, false, event.clientX, event.clientY);
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.focus({ preventScroll: true });
        drag.pointerId = event.pointerId;
        drag.handle = event.currentTarget;
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        const drag = active.current;
        if (!drag || drag.keyboard || drag.pointerId !== event.pointerId)
          return;
        if (!valid(drag)) {
          cancel();
          return;
        }
        if (
          !drag.started &&
          Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6
        )
          return;
        drag.started = true;
        drag.x = event.clientX;
        drag.y = event.clientY;
        locate(drag);
        if (!frame.current) frame.current = requestAnimationFrame(scroll);
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        const drag = active.current;
        if (!drag || drag.keyboard || drag.pointerId !== event.pointerId)
          return;
        if (drag.started) {
          drag.x = event.clientX;
          drag.y = event.clientY;
          locate(drag);
          suppressUntil.current = Date.now() + 500;
          void finish();
        } else release();
      },
      onPointerCancel() {
        if (active.current) cancel();
      },
      onLostPointerCapture() {
        if (active.current) cancel();
      },
    };
  }
  function handleProps(id: string) {
    const item = options.items.find((row) => row.id === id);
    return {
      ...pointerProps(id),
      "data-reorder-handle": true,
      "aria-label": `Drag to reorder ${item?.name ?? "item"}`,
      "aria-describedby": instructionsId,
      "aria-pressed": view?.id === id,
      title: "Drag to reorder",
      disabled:
        busy ||
        options.enabled === false ||
        !item ||
        options.items.filter((row) => row.group === item.group).length < 2,
      onClick(event: React.MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const drag = active.current;
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          if (drag?.id === id && drag.keyboard) void finish();
          else if (!drag) pickup(id, true);
        } else if (
          drag?.id === id &&
          drag.keyboard &&
          ["ArrowUp", "ArrowDown"].includes(event.key)
        ) {
          event.preventDefault();
          if (!valid(drag)) {
            cancel();
            return;
          }
          const group = groupItems(drag.group),
            source = group.findIndex((row) => row.id === id);
          drag.destination = Math.max(
            0,
            Math.min(
              group.length - 1,
              drag.destination + (event.key === "ArrowUp" ? -1 : 1),
            ),
          );
          drag.targetId = group[drag.destination].id;
          drag.placement = drag.destination > source ? "after" : "before";
          preview(drag);
          setView({ ...drag });
          setAnnouncement(
            `Position ${drag.destination + 1} of ${group.length}.`,
          );
        }
      },
    };
  }
  function iconProps(id: string) {
    const handle = handleProps(id);
    return {
      ...pointerProps(id, true),
      "data-reorder-icon": true,
      "aria-pressed": handle.disabled ? undefined : handle["aria-pressed"],
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (handle.disabled || (event.key === "Enter" && !active.current))
          return;
        handle.onKeyDown(event);
      },
    };
  }
  function itemProps(id: string) {
    return {
      "data-reorder-list": listId,
      "data-reorder-id": id,
      "data-reorder-dragging": view?.id === id || undefined,
      "data-reorder-drop":
        view?.targetId === id && view.id !== id ? view.placement : undefined,
      onDragStart(event: React.DragEvent) {
        event.preventDefault();
      },
      onClickCapture(event: React.MouseEvent) {
        if (Date.now() < suppressUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    };
  }
  return {
    itemProps,
    handleProps,
    pointerProps,
    iconProps,
    busy,
    error,
    announcement,
    instructionsId,
  };
}
export type DragReorder = ReturnType<typeof useDragReorder>;
export function ReorderHandle({ drag, id }: { drag: DragReorder; id: string }) {
  return (
    <button
      type="button"
      className="reorderDragHandle"
      {...drag.handleProps(id)}
    >
      <svg
        aria-hidden="true"
        width="12"
        height="18"
        viewBox="0 0 12 18"
        fill="currentColor"
      >
        <circle cx="3" cy="3" r="1.5" />
        <circle cx="9" cy="3" r="1.5" />
        <circle cx="3" cy="9" r="1.5" />
        <circle cx="9" cy="9" r="1.5" />
        <circle cx="3" cy="15" r="1.5" />
        <circle cx="9" cy="15" r="1.5" />
      </svg>
    </button>
  );
}
export function ReorderStatus({ drag }: { drag: DragReorder }) {
  return (
    <>
      <span className="srOnly" id={drag.instructionsId}>
        Drag to reorder. Keyboard: Space to pick up, arrow keys to move, Space
        to drop, Escape to cancel.
      </span>
      <span className="srOnly" role="status">
        {drag.announcement}
      </span>
      {drag.error && (
        <p className="reorderError" role="alert">
          {drag.error}
        </p>
      )}
    </>
  );
}
