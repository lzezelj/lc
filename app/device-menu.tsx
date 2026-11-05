"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DeviceSelection } from "./device-selection";
import {
  MicrophoneModeSelector,
  EchoCancellationToggle,
} from "./microphone-processing";

export type MediaDeviceOption = { deviceId: string; label: string };

type DeviceMenuProps = {
  kind: "microphone" | "camera" | "headphones";
  disabled: boolean;
  unavailable?: boolean;
  actionUnavailable?: boolean;
  extraOptions?: ReactNode;
  devices: MediaDeviceOption[];
  selectedId: string;
  onAction: () => void;
  onSelect: (deviceId: string) => void;
};

export function DeviceMenu({
  kind,
  disabled,
  unavailable = false,
  actionUnavailable = false,
  extraOptions,
  devices,
  selectedId,
  onAction,
  onSelect,
}: DeviceMenuProps) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div
      className={`deviceControl ${open ? "open" : ""} ${disabled ? "mediaDisabled" : ""}`}
      ref={menu}
    >
      <button
        className="mediaToggle"
        disabled={unavailable || actionUnavailable}
        aria-pressed={disabled}
        aria-label={
          kind === "microphone"
            ? disabled
              ? "Unmute microphone"
              : "Mute microphone"
            : kind === "headphones"
              ? disabled
                ? "Undeafen"
                : "Deafen (mute microphone and headphones)"
              : disabled
                ? "Turn camera on"
                : "Turn camera off"
        }
        title={
          kind === "microphone"
            ? disabled
              ? "Unmute"
              : "Mute"
            : kind === "headphones"
              ? disabled
                ? "Undeafen"
                : "Deafen (mute microphone and headphones)"
              : disabled
                ? "Turn camera on"
                : "Turn camera off"
        }
        onClick={onAction}
      >
        <MediaIcon kind={kind} crossedOut={disabled} />
      </button>
      <button
        className="deviceMenuTrigger"
        disabled={unavailable}
        aria-label={kind === "headphones" ? "Output options" : `Choose ${kind}`}
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        ▴
      </button>
      {open && !unavailable && (
        <div className="deviceDropdown">
          {kind === "microphone" && (
            <>
              <MicrophoneModeSelector />
              <EchoCancellationToggle />
            </>
          )}
          {kind !== "headphones" && (
            <DeviceSelection
              label={kind === "microphone" ? "Microphone" : "Camera"}
              devices={devices}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}
          {extraOptions}
        </div>
      )}
    </div>
  );
}

export function MediaIcon({
  kind,
  crossedOut,
}: {
  kind: "microphone" | "camera" | "screen" | "headphones";
  crossedOut: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === "microphone" ? (
        <>
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
        </>
      ) : kind === "headphones" ? (
        <path d="M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H3zM17 13h4v8h-4z" />
      ) : kind === "camera" ? (
        <>
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="m16 10 6-3v10l-6-3z" />
        </>
      ) : (
        <>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </>
      )}
      {crossedOut && <path d="M3 3l18 18" />}
    </svg>
  );
}
