"use client";

export function MessageHeader({
  name,
  time,
  onProfile,
}: {
  name: string;
  time: string;
  onProfile: () => void;
}) {
  return (
    <div className="messageHeader">
      <button type="button" className="profileLink" onClick={onProfile}>
        {name}
      </button>
      <time>{time}</time>
    </div>
  );
}
