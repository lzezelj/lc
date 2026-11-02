"use client";

import type { MediaDeviceOption } from "./device-menu";

export function DeviceSelection({
  label,
  devices,
  selectedId,
  onSelect,
  disabled = false,
  note,
}: {
  label: string;
  devices: MediaDeviceOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <div className="deviceSelection">
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
    </div>
  );
}
