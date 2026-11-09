import { Avatar } from "./avatar";
import { statusLabels, type UserStatus } from "./user-status-menu";

export function StatusAvatar({
  name,
  image,
  status,
  className = "",
}: {
  name: string;
  image?: string | null;
  status: UserStatus | "offline";
  className?: string;
}) {
  const label = status === "offline" ? "Offline" : statusLabels[status];
  return (
    <span className="statusAvatar">
      <Avatar name={name} image={image} className={className} />
      <span
        className={`friendStatusDot statusDot status-${status}`}
        role="img"
        aria-label={label}
        title={label}
      />
    </span>
  );
}
