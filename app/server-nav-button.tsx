"use client";
import { useId, type MouseEvent } from "react";
import { UnreadIndicator } from "./unread-indicator";

export function ServerNavButton({
  server,
  active,
  unread,
  mentions = 0,
  voiceUsers,
  onClick,
  onContextMenu,
}: {
  server: { id: string; name: string };
  active?: boolean;
  unread?: boolean;
  mentions?: number;
  voiceUsers: { userId?: string; name: string }[];
  onClick: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
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
      onPointerEnter={(event) => position(event.currentTarget)}
      onFocus={(event) => position(event.currentTarget)}
    >
      <button
        className={`workspaceButton ${active ? "active" : ""}`}
        aria-label={`${server.name}${unread ? ", unread messages" : ""}${mentions ? `, ${mentions} unread mentions` : ""}${voiceUsers.length ? `, ${voiceUsers.length} in voice` : ""}`}
        aria-describedby={tooltip}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {server.name[0]?.toUpperCase()}
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
