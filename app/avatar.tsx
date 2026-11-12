"use client";
import { useState } from "react";
import { usePictureSource } from "./picture-cache-provider";

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
  const source = usePictureSource(image);
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
      {hasImage && source ? (
        // External profile images retain their existing source; no optimizer proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={
            showPlaceholder
              ? async (event) => {
                  const element = event.currentTarget;
                  const loadedSource = source;
                  try {
                    await element.decode();
                    if (
                      element.isConnected &&
                      element.getAttribute("src") === loadedSource
                    )
                      setDecoded(image!);
                  } catch {
                    if (
                      element.isConnected &&
                      element.getAttribute("src") === loadedSource
                    )
                      setFailed(image!);
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
