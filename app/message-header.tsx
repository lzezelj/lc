"use client";
import { Avatar } from "./avatar";

export function MessageHeader({
  name,
  time,
  onProfile,
  edited,
  image,
}: {
  name: string;
  time: string;
  onProfile: () => void;
  edited?: boolean;
  image?: string | null;
}) {
  return (
    <div className="messageHeader">
      <button type="button" className="profileLink" onClick={onProfile}>
        <Avatar name={name} image={image} />
        <span className="messageAuthorName">{name}</span>
      </button>
      <time>{time}</time>
      {edited && <small className="messageEdited">(edited)</small>}
    </div>
  );
}
