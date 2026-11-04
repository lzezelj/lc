"use client";

export function MessageHeader({
  name,
  time,
  onProfile,
  edited,
}: {
  name: string;
  time: string;
  onProfile: () => void;
  edited?: boolean;
}) {
  return (
    <div className="messageHeader">
      <button type="button" className="profileLink" onClick={onProfile}>
        {name}
      </button>
      <time>{time}</time>
      {edited && <small className="messageEdited">(edited)</small>}
    </div>
  );
}
