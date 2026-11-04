"use client";
export function UnreadIndicator({
  unread,
  mentions = 0,
  server = false,
}: {
  unread?: boolean;
  mentions?: number;
  server?: boolean;
}) {
  if (!unread && !mentions) return null;
  return (
    <span
      className={`activityIndicator ${server ? "serverActivityIndicator" : ""}`}
      role="img"
      aria-label={mentions ? `${mentions} unread mentions` : "Unread messages"}
    >
      <span className="activityDot" aria-hidden="true" />
      {mentions > 0 && (
        <span className="activityMentionCount" aria-hidden="true">
          {mentions > 99 ? "99+" : mentions}
        </span>
      )}
    </span>
  );
}
