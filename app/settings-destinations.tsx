"use client";

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
      <div
        className="friendTabs"
        role="group"
        aria-label={`${label} categories`}
      >
        {(["server", "direct"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={category === kind}
            className={category === kind ? "active" : ""}
            onClick={() => onCategory(kind)}
          >
            {kind === "server" ? "Servers" : "People"}
          </button>
        ))}
      </div>
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
