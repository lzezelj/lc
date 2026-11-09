"use client";

import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
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
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [placement, setPlacement] = useState<{
    parent: HTMLElement;
    style: CSSProperties;
  } | null>(null);
  useLayoutEffect(() => {
    if (!open || unavailable) return;
    const position = () => {
      const root = menu.current;
      const anchor = trigger.current?.getBoundingClientRect();
      if (!root || !anchor) return;
      const dialog = root.closest("dialog");
      const sidebar = !dialog
        ? root
            .closest(".workspace")
            ?.querySelector(".channelSidebar")
            ?.getBoundingClientRect()
        : undefined;
      const width = Math.min(
        sidebar && sidebar.width > 0 ? sidebar.width - 16 : 300,
        innerWidth - 16,
      );
      const left = Math.max(
        8,
        Math.min(
          sidebar && sidebar.width > 0 ? sidebar.left + 8 : anchor.left,
          innerWidth - width - 8,
        ),
      );
      setPlacement({
        parent: dialog ?? document.body,
        style: {
          position: "fixed",
          left,
          width,
          bottom: Math.max(8, innerHeight - anchor.top + 8),
          maxHeight: Math.max(40, Math.min(360, anchor.top - 16)),
        },
      });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, unavailable]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
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
        ref={trigger}
        disabled={unavailable}
        aria-label={kind === "headphones" ? "Output options" : `Choose ${kind}`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        ▴
      </button>
      {open &&
        !unavailable &&
        placement &&
        createPortal(
          <div
            className="deviceDropdown deviceDropdownPortal"
            ref={panel}
            id={panelId}
            style={placement.style}
          >
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
          </div>,
          placement.parent,
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
