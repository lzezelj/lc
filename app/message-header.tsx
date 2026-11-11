"use client";
import { Avatar } from "./avatar";

export function MessageHeader({
  name,
  time,
  onProfile,
  edited,
  editedByAdmin,
  image,
}: {
  name: string;
  time: string;
  onProfile: () => void;
  edited?: boolean;
  editedByAdmin?: boolean;
  image?: string | null;
}) {
  return (
    <div className="messageHeader">
      <button type="button" className="profileLink" onClick={onProfile}>
        <Avatar name={name} image={image} />
        <span className="messageAuthorName">{name}</span>
      </button>
      <time>{time}</time>
      {edited && (
        <small className="messageEdited">
          {editedByAdmin ? "(edited by admin)" : "(edited)"}
        </small>
      )}
    </div>
  );
}
