"use client";

import { useEffect, useRef, useState } from "react";

export type MediaDeviceOption = { deviceId: string; label: string };

type DeviceMenuProps = {
  kind: "microphone" | "camera";
  disabled: boolean;
  devices: MediaDeviceOption[];
  selectedId: string;
  onAction: () => void;
  onSelect: (deviceId: string) => void;
  onRestart?: () => void;
};

export function DeviceMenu({
  kind,
  disabled,
  devices,
  selectedId,
  onAction,
  onSelect,
  onRestart,
}: DeviceMenuProps) {
  const [open, setOpen] = useState(false);
  const [processing, setProcessing] = useState(true);
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
        aria-label={
          kind === "microphone"
            ? disabled
              ? "Unmute microphone"
              : "Mute microphone"
            : disabled
              ? "Turn camera on"
              : "Turn camera off"
        }
        title={
          kind === "microphone"
            ? disabled
              ? "Unmute"
              : "Mute"
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
        aria-label={`Choose ${kind}`}
        aria-expanded={open}
        onClick={() => {
          setProcessing(
            localStorage.getItem("lc.microphoneProcessing") !== "off",
          );
          setOpen((current) => !current);
        }}
      >
        ▴
      </button>
      {open && (
        <div className="deviceDropdown">
          {onRestart && (
            <>
              <button
                onClick={() => {
                  onRestart();
                  setOpen(false);
                }}
              >
                Restart microphone
              </button>
              <button
                onClick={() => {
                  const next =
                    localStorage.getItem("lc.microphoneProcessing") === "off";
                  localStorage.setItem(
                    "lc.microphoneProcessing",
                    next ? "on" : "off",
                  );
                  setProcessing(next);
                  onRestart();
                  setOpen(false);
                }}
              >
                {processing ? "Disable" : "Enable"} microphone processing
              </button>
            </>
          )}
          <button
            className={!selectedId ? "selected" : ""}
            onClick={() => {
              onSelect("");
              setOpen(false);
            }}
          >
            System default
          </button>
          {devices.map((device) => (
            <button
              className={device.deviceId === selectedId ? "selected" : ""}
              key={device.deviceId}
              onClick={() => {
                onSelect(device.deviceId);
                setOpen(false);
              }}
            >
              {device.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MediaIcon({
  kind,
  crossedOut,
}: {
  kind: "microphone" | "camera" | "screen";
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
