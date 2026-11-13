"use client";
import type { ReactNode } from "react";

export function SwitchControl({
  label,
  checked,
  onChange,
  disabled = false,
  className = "",
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={`switchRow ${className}`}>
      <span className="switchLabel">{label}</span>
      <span className="switchState" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
