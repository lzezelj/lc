"use client";
import { useState } from "react";

export function Avatar({
  name,
  image,
  small = false,
  className = "",
  showPlaceholder = false,
}: {
  name: string;
  image?: string | null;
  small?: boolean;
  className?: string;
  showPlaceholder?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const hasImage = !!image && failed !== image;
  const ready = hasImage && decoded === image;
  const initial = name.trim()[0]?.toUpperCase() || "?";
  return (
    <span
      className={`userAvatar ${small ? "userAvatarSmall" : ""} ${className} ${showPlaceholder ? "avatarWithPlaceholder" : ""} ${ready ? "avatarImageReady" : ""}`}
      aria-hidden="true"
    >
      {showPlaceholder && <span className="avatarInitial">{initial}</span>}
      {hasImage ? (
        // External profile images retain their existing source; no optimizer proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={
            showPlaceholder
              ? async (event) => {
                  const element = event.currentTarget;
                  const source = image;
                  try {
                    await element.decode();
                    if (
                      element.isConnected &&
                      element.getAttribute("src") === source
                    )
                      setDecoded(source);
                  } catch {
                    if (
                      element.isConnected &&
                      element.getAttribute("src") === source
                    )
                      setFailed(source);
                  }
                }
              : undefined
          }
          onError={() => setFailed(image)}
        />
      ) : (
        !showPlaceholder && initial
      )}
    </span>
  );
}
