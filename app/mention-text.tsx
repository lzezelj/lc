"use client";
import type { Mention } from "./notification-types";
export function MentionText({
  text,
  mentions = [],
  onProfile,
}: {
  text: string;
  mentions?: Mention[];
  onProfile?: (user: { id: string; name: string }) => void;
}) {
  const parts = [];
  let cursor = 0;
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (
      mention.start < cursor ||
      mention.end > text.length ||
      mention.start < 0 ||
      mention.end <= mention.start
    )
      continue;
    parts.push(text.slice(cursor, mention.start));
    parts.push(
      <button
        key={`${mention.userId}:${mention.start}`}
        type="button"
        className="messageMention"
        onClick={() => onProfile?.({ id: mention.userId, name: mention.name })}
      >
        {text.slice(mention.start, mention.end)}
      </button>,
    );
    cursor = mention.end;
  }
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
