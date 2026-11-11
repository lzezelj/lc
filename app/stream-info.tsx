"use client";

import { useId } from "react";

export function StreamInfo({
  quality,
  stats,
  name,
}: {
  quality: string;
  stats: string;
  name: string;
}) {
  const id = useId();
  return (
    <div
      className="streamInfo"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <div className="streamSummary">
        {quality && <small className="qualityBadge">{quality}</small>}
        {stats && <small className="networkBadge">{stats}</small>}
      </div>
      <button
        className="fullscreenExit"
        type="button"
        aria-label="Exit fullscreen"
        onClick={() => void document.exitFullscreen().catch(() => {})}
      >
        Exit fullscreen
      </button>
      <button
        className="streamInfoTrigger"
        type="button"
        aria-label="Stream information"
        aria-describedby={id}
      >
        i
      </button>
      <div className="streamInfoTooltip" id={id} role="tooltip">
        <strong>{name}</strong>
        <small>{quality || "Resolution unavailable"}</small>
        <small>{stats || "Waiting for stream statistics…"}</small>
      </div>
    </div>
  );
}

export function fullscreenVideoTile(grid: HTMLElement | null) {
  if (document.fullscreenElement)
    return document.exitFullscreen().catch(() => {});
  const tile = grid?.matches(".videoCard:not(.nameOnly)")
    ? grid
    : grid?.querySelector<HTMLElement>(
        ".videoCard:not(.videoHidden):not(.nameOnly)",
      );
  if (!tile?.requestFullscreen) return;
  return tile.requestFullscreen().catch(() => {});
}

export function directionalStreamStats(
  stats: string,
  direction: "up" | "down",
) {
  const transfer = stats.match(
    new RegExp(`${direction} \\d+ kbps(?: · \\d+ fps)?`),
  )?.[0];
  const ping = stats.match(/\d+ ms ping/)?.[0];
  return [transfer, ping].filter(Boolean).join(" · ");
}
