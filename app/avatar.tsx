"use client";
import { useState } from "react";

export function Avatar({
  name,
  image,
  small = false,
  className = "",
}: {
  name: string;
  image?: string | null;
  small?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={`userAvatar ${small ? "userAvatarSmall" : ""} ${className}`}
      aria-hidden="true"
    >
      {image && failed !== image ? (
        // External profile images retain their existing source; no optimizer proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(image)}
        />
      ) : (
        name.trim()[0]?.toUpperCase() || "?"
      )}
    </span>
  );
}
