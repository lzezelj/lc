"use client";

export type CallTile = { id: string; label: string };

export function SelfViewButton({
  hidden,
  onToggle,
}: {
  hidden: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="selfViewToggle"
      aria-pressed={!hidden}
      title="Only changes your own camera and screen previews"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {hidden ? "Show yourself" : "Hide yourself"}
    </button>
  );
}

export function HideTileButton({
  label,
  onHide,
}: {
  label: string;
  onHide: () => void;
}) {
  return (
    <button
      type="button"
      className="tileHide"
      title={`Hide ${label} for me`}
      aria-label={`Hide ${label} for me`}
      onClick={(event) => {
        event.stopPropagation();
        onHide();
      }}
    >
      Hide
    </button>
  );
}

export function HiddenTilesMenu({
  tiles,
  hiddenIds,
  onRestore,
}: {
  tiles: CallTile[];
  hiddenIds: string[];
  onRestore: (id: string) => void;
}) {
  const hidden = tiles.filter((tile) => hiddenIds.includes(tile.id));
  if (!hidden.length) return null;
  return (
    <details
      className="hiddenTilesMenu"
      onClick={(event) => event.stopPropagation()}
    >
      <summary>Hidden windows ({hidden.length})</summary>
      <div>
        {hidden.map((tile) => (
          <button
            type="button"
            key={tile.id}
            onClick={() => onRestore(tile.id)}
          >
            Show {tile.label}
          </button>
        ))}
      </div>
    </details>
  );
}
