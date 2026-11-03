"use client";

export function StreamVolume({
  volume,
  onChange,
}: {
  volume: number;
  onChange: (volume: number) => void;
}) {
  return (
    <div
      className="streamVolume"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={volume ? "Mute stream audio" : "Unmute stream audio"}
        onClick={() => onChange(volume ? 0 : 100)}
      >
        <svg
          aria-hidden="true"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M11 5 6 9H3v6h3l5 4Z" />
          {volume ? (
            <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
          ) : (
            <path d="m16 9 6 6m0-6-6 6" />
          )}
        </svg>
      </button>
      <label>
        Stream volume: {volume}%
        <input
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
