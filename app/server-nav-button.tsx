"use client";
import { useId, type MouseEvent } from "react";
import { preload } from "react-dom";
import { UnreadIndicator } from "./unread-indicator";
import { Avatar } from "./avatar";
import type { DragReorder } from "./drag-reorder";

export function preloadServerPictures(servers: { image?: string | null }[]) {
  for (const server of servers) {
    if (server.image)
      preload(server.image, {
        as: "image",
        referrerPolicy: "no-referrer",
        fetchPriority: "low",
      });
  }
}

export function ServerNavButton({
  server,
  active,
  unread,
  mentions = 0,
  voiceUsers,
  onClick,
  onContextMenu,
  drag,
}: {
  server: { id: string; name: string; image?: string | null };
  active?: boolean;
  unread?: boolean;
  mentions?: number;
  voiceUsers: { userId?: string; name: string }[];
  onClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  drag?: DragReorder;
}) {
  const tooltip = useId();
  const position = (element: HTMLElement) => {
    const top = element.getBoundingClientRect().top + 23;
    const estimatedHeight = Math.min(
      innerHeight - 16,
      34 + voiceUsers.length * 22,
    );
    element.style.setProperty(
      "--server-tooltip-top",
      `${Math.max(estimatedHeight / 2 + 8, Math.min(innerHeight - estimatedHeight / 2 - 8, top))}px`,
    );
  };
  return (
    <div
      className="serverButtonWrap"
      {...drag?.itemProps(server.id)}
      onPointerEnter={(event) => position(event.currentTarget)}
      onFocus={(event) => position(event.currentTarget)}
    >
      <button
        {...drag?.iconProps(server.id)}
        className={`workspaceButton ${active ? "active" : ""}`}
        aria-label={`${server.name}${unread ? ", unread messages" : ""}${mentions ? `, ${mentions} unread mentions` : ""}${voiceUsers.length ? `, ${voiceUsers.length} in voice` : ""}`}
        aria-describedby={drag ? `${tooltip} ${drag.instructionsId}` : tooltip}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <Avatar
          name={server.name}
          image={server.image}
          className="serverPicture"
          showPlaceholder
        />
        <UnreadIndicator unread={unread} mentions={mentions} server />
        {voiceUsers.length > 0 && (
          <span className="serverVoiceBadge" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
            </svg>
            <span>{voiceUsers.length}</span>
          </span>
        )}
      </button>
      <span className="serverTooltip" role="tooltip" id={tooltip}>
        <strong>{server.name}</strong>
        {voiceUsers.map((person, index) => (
          <span className="serverTooltipPerson" key={person.userId ?? index}>
            {person.name}
          </span>
        ))}
      </span>
    </div>
  );
}
