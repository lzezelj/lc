"use client";

import type { MediaDeviceOption } from "./device-menu";
import { InformationHint } from "./information-hint";

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
        <span className="settingsFieldLabel">
          {label}
          {note && <InformationHint text={note} />}
        </span>
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
    </div>
  );
}
