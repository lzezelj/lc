"use client";

import { useEffect, useRef, useState } from "react";
import { mergeHelpBoxes, type HelpBox } from "./help-geometry";

type Box = HelpBox;
export type HelpTarget = {
  selectors: string[];
  fallbacks?: string[];
  hint?: string;
};

function visibleBox(element: Element): Box | null {
  const rect = element.getBoundingClientRect();
  let left = Math.max(4, rect.left - 5),
    top = Math.max(4, rect.top - 5);
  let right = Math.min(innerWidth - 4, rect.right + 5),
    bottom = Math.min(innerHeight - 4, rect.bottom + 5);
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    getComputedStyle(element).visibility === "hidden"
  )
    return null;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent),
      bounds = parent.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return null;
    if (/(hidden|clip|auto|scroll)/.test(style.overflowX)) {
      left = Math.max(left, bounds.left);
      right = Math.min(right, bounds.right);
    }
    if (/(hidden|clip|auto|scroll)/.test(style.overflowY)) {
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  return right - left > 4 && bottom - top > 4
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}

export function HelpSpotlight({ target }: { target: HelpTarget }) {
  const root = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<{
    boxes: Box[];
    width: number;
    height: number;
    fallback: boolean;
  }>({ boxes: [], width: 0, height: 0, fallback: false });
  useEffect(() => {
    const element = root.current?.closest("dialog");
    if (!element) return;
    const dialog = element;
    let frame = 0,
      signature = "";
    const observed = new Set<Element>();
    const resize = new ResizeObserver(() => schedule());
    const pick = (selectors: string[]) =>
      [
        ...new Set(
          selectors.flatMap((selector) => [
            ...document.querySelectorAll(selector),
          ]),
        ),
      ]
        .filter((element) => !dialog.contains(element))
        .flatMap((element) => {
          if (!observed.has(element)) {
            observed.add(element);
            resize.observe(element);
          }
          const box = visibleBox(element);
          return box ? [box] : [];
        })
        .slice(0, 8);
    function measure() {
      frame = 0;
      let boxes = pick(target.selectors);
      const fallback = !boxes.length;
      if (fallback) boxes = pick(target.fallbacks ?? []);
      boxes = mergeHelpBoxes(boxes);
      const next = { boxes, width: innerWidth, height: innerHeight, fallback };
      const serialized = JSON.stringify(next);
      if (serialized !== signature) {
        signature = serialized;
        setView(next);
      }
      if (!boxes.length) {
        dialog.removeAttribute("data-help-spotlight");
        return;
      }
      dialog.setAttribute("data-help-spotlight", "true");
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }
    resize.observe(dialog);
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    });
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
      dialog.removeAttribute("data-help-spotlight");
    };
  }, [target]);
  // One cutout per disjoint rectangle keeps overlapping target regions clear.
  const boxes = view.boxes.filter(
    (box, index, all) =>
      !all.some(
        (other, otherIndex) =>
          otherIndex < index &&
          box.x >= other.x &&
          box.y >= other.y &&
          box.x + box.width <= other.x + other.width &&
          box.y + box.height <= other.y + other.height,
      ),
  );
  return (
    <div ref={root} className="helpSpotlight">
      {boxes.length > 0 && (
        <svg
          className="helpSpotlightCanvas"
          width={view.width}
          height={view.height}
          aria-hidden="true"
        >
          <defs>
            <mask id="lc-help-cutouts">
              <rect width="100%" height="100%" fill="white" />
              {boxes.map((box, index) => (
                <rect
                  key={index}
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx="8"
                  fill="black"
                />
              ))}
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="#05070cb8"
            mask="url(#lc-help-cutouts)"
          />
          {boxes.map((box, index) => (
            <rect
              className="helpTargetOutline"
              key={index}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx="8"
              fill="#a7b8ff10"
              stroke="#b7c7ff"
              strokeWidth="3"
            />
          ))}
        </svg>
      )}
      {view.fallback && target.hint && (
        <p className="helpTargetHint">{target.hint}</p>
      )}
    </div>
  );
}
