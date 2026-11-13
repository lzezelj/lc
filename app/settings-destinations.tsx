"use client";
import { SegmentedControl } from "./segmented-control";

export function SettingsDestinations({
  category,
  onCategory,
  query,
  onQuery,
  label,
}: {
  category: "server" | "direct";
  onCategory: (category: "server" | "direct") => void;
  query: string;
  onQuery: (query: string) => void;
  label: string;
}) {
  return (
    <div className="settingsDestinations">
      <SegmentedControl
        label={`${label} categories`}
        value={category}
        onChange={onCategory}
        options={[
          { value: "server", label: "Servers" },
          { value: "direct", label: "People" },
        ]}
      />
      <input
        type="search"
        aria-label={`Search ${label.toLowerCase()} ${category === "server" ? "servers" : "people"}`}
        placeholder={category === "server" ? "Search servers" : "Search people"}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
      />
      <h4>{category === "server" ? "Servers" : "People"}</h4>
    </div>
  );
}
