import type { ReactNode } from "react";
import { InformationHint } from "./information-hint";

export function SettingsSection({
  title,
  hint,
  className = "",
  children,
  panel = true,
}: {
  title: string;
  hint?: string;
  className?: string;
  children: ReactNode;
  panel?: boolean;
}) {
  return (
    <section className="settingsSection">
      <h3 className="settingsFieldLabel">
        {title}
        {hint && <InformationHint text={hint} />}
      </h3>
      <div
        className={`${panel ? "settingsSectionPanel" : "settingsSectionBody"} ${className}`}
      >
        {children}
      </div>
    </section>
  );
}
