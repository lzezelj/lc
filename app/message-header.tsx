"use client";
import { Avatar } from "./avatar";
import { formatMessageTimestamp } from "./message-timestamp";
import { useMessageDay } from "./use-message-day";

export function MessageHeader({
  name,
  time,
  sentAt,
  onProfile,
  edited,
  editedByAdmin,
  image,
}: {
  name: string;
  time: string;
  sentAt?: number;
  onProfile: () => void;
  edited?: boolean;
  editedByAdmin?: boolean;
  image?: string | null;
}) {
  const today = useMessageDay();
  const valid = sentAt !== undefined && Number.isFinite(sentAt);
  const label = valid ? formatMessageTimestamp(sentAt, today) : time;
  return (
    <div className="messageHeader">
      <button type="button" className="profileLink" onClick={onProfile}>
        <Avatar name={name} image={image} />
        <span className="messageAuthorName">{name}</span>
      </button>
      <time
        dateTime={valid ? new Date(sentAt).toISOString() : undefined}
        title={valid ? new Date(sentAt).toLocaleString() : time}
      >
        {label}
      </time>
      {edited && (
        <small className="messageEdited">
          {editedByAdmin ? "(edited by admin)" : "(edited)"}
        </small>
      )}
    </div>
  );
}
