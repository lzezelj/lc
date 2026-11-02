"use client";

import type { MediaDeviceOption } from "./device-menu";

export function DeviceSelection({
  title,
  label,
  devices,
  selectedId,
  onSelect,
  disabled = false,
  note,
}: {
  title: string;
  label: string;
  devices: MediaDeviceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <details className="deviceChoices" open>
      <summary>{title}</summary>
      <label>
        {label}
        <select
          value={selectedId}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">System default</option>
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
      {note && <small className="deviceSelectionNote">{note}</small>}
    </details>
  );
}
