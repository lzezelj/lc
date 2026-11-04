"use client";

import { useEffect, useRef } from "react";
import { DeviceMenu } from "./device-menu";
import { SettingsIcon } from "./settings-modal";

const inactive = () => {};
export function HelpCallPreview({
  name = "You",
  status = "Online",
  statusCode = "online",
}: {
  name?: string;
  status?: string;
  statusCode?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const profile = document.querySelector(".profileBar");
    const place = () => {
      const bounds = profile?.getBoundingClientRect();
      const width = Math.min(
        bounds && bounds.width > 120 ? bounds.width : 360,
        innerWidth - 24,
      );
      const left =
        bounds && bounds.right > 0 && bounds.left < innerWidth
          ? bounds.left
          : 12;
      root.current?.style.setProperty(
        "--preview-left",
        `${Math.max(12, Math.min(left, innerWidth - width - 12))}px`,
      );
      root.current?.style.setProperty("--preview-width", `${width}px`);
    };
    place();
    const observer = new ResizeObserver(place);
    if (profile) observer.observe(profile);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, []);
  const device = (
    kind: "camera" | "microphone" | "headphones",
    off = false,
  ) => (
    <DeviceMenu
      kind={kind}
      disabled={off}
      unavailable
      devices={[]}
      selectedId=""
      onAction={inactive}
      onSelect={inactive}
    />
  );
  return (
    <div
      className="helpCallPreview"
      ref={root}
      aria-label="Example connected call controls"
    >
      <div className="controls helpPreviewControls">
        {device("camera", true)}
        <button type="button" disabled>
          Share screen
        </button>
        <button type="button" disabled>
          Soundboard
        </button>
      </div>
      <div className="helpPreviewStatus">
        <span>
          <strong>Connected</strong>
          <small>Connection quality</small>
        </span>
        <span className="helpPreviewQuality" aria-hidden="true" />
        <button
          className="helpPreviewInfo"
          type="button"
          disabled
          aria-label="Example connection information"
        >
          i
        </button>
        <button
          className="helpPreviewDisconnect"
          type="button"
          disabled
          aria-label="Example disconnect"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M3 15v-4c5-5 13-5 18 0v4l-5-1v-3a13 13 0 0 0-8 0v3z" />
          </svg>
        </button>
      </div>
      <div className="helpPreviewProfile">
        <span className="helpPreviewAvatar" aria-hidden="true">
          {name[0]?.toUpperCase() ?? "Y"}
        </span>
        <span className="helpPreviewIdentity">
          <strong>{name}</strong>
          <small>
            <span className={`statusDot status-${statusCode}`} />
            {status}
          </small>
        </span>
        <div className="controls helpPreviewAudio">
          {device("microphone")}
          {device("headphones")}
          <button
            type="button"
            className="helpPreviewSettings"
            disabled
            aria-label="Example settings"
          >
            <SettingsIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
