"use client";

import { useState } from "react";

const colors = {
  deep: ["Page background", "#0d1018"],
  panel: ["Sidebars and dialogs", "#151925"],
  surface: ["Conversation background", "#1b2030"],
  card: ["Message background", "#171c29"],
  ink: ["Main text", "#f5f7fb"],
  muted: ["Secondary text", "#98a1b2"],
  line: ["Borders", "#252b3b"],
  accent: ["Accent", "#78a4ff"],
  "accent-ink": ["Text on accent", "#0d182b"],
} as const;
const sliders = {
  size: ["Message text size", 14, 12, 22],
  leading: ["Message line height", 1.5, 1.2, 2],
  padding: ["Message padding", 12, 4, 24],
  gap: ["Message spacing", 12, 0, 24],
  radius: ["Message and dialog corners", 9, 0, 24],
} as const;
const initialColors = Object.fromEntries(
  Object.entries(colors).map(([key, value]) => [key, value[1]]),
);
const initialNumbers = Object.fromEntries(
  Object.entries(sliders).map(([key, value]) => [key, value[1]]),
);

export function DesignPlayground() {
  const [palette, setPalette] = useState<Record<string, string>>(initialColors);
  const [numbers, setNumbers] =
    useState<Record<string, number>>(initialNumbers);
  const [enabled, setEnabled] = useState(false);
  const css = `/* LZRelay design experiment: review before adding to shared styles. */
:root {
${Object.entries(palette)
  .map(([key, value]) => `  --${key}: ${value};`)
  .join("\n")}
}
.workspace { background: var(--surface); }
.workspace .room, .workspace .roomHeader { background: var(--surface); }
.workspace .workspaceRail { background: var(--deep); }
.settingsModal, .settingsNavigation, .settingsModalSurface { background: var(--panel); }
.settingsModal { border-radius: ${numbers.radius}px; border-color: var(--line); }
.chat .chatLog > article {
  background: var(--card); border-color: var(--line);
  border-radius: ${numbers.radius}px;
  padding: ${numbers.padding}px 14px; margin-block: ${numbers.gap}px;
}
.chat .chatLog > article:hover:not(:has(.replyPreview:hover)) { background: color-mix(in srgb, var(--card), var(--ink) 5%); }
.chat .chatLog > article p { font-size: ${numbers.size}px; line-height: ${numbers.leading}; }
.chat b, .replyPreview strong { color: var(--ink); }
`;

  function exportCss() {
    const url = URL.createObjectURL(new Blob([css], { type: "text/css" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "lzrelay-design-experiment.css";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      {enabled && <style>{css}</style>}
      <button
        className="designPlaygroundLauncher"
        popoverTarget="design-playground"
      >
        Design lab
      </button>
      <aside
        id="design-playground"
        popover="auto"
        className="designPlayground"
        aria-label="Design playground"
      >
        <header>
          <strong>Design lab</strong>
          <button
            popoverTarget="design-playground"
            popoverTargetAction="hide"
            aria-label="Close design lab"
          >
            ×
          </button>
        </header>
        <p>
          Development preview only. Changes are temporary and disappear on
          reload. Close this panel to inspect your design.
        </p>
        <label className="designPlaygroundToggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />{" "}
          Preview changes
        </label>
        <fieldset>
          <legend>Palette</legend>
          {Object.entries(colors).map(([key, [label]]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                type="color"
                value={palette[key]}
                onChange={(event) => {
                  setPalette({ ...palette, [key]: event.target.value });
                  setEnabled(true);
                }}
              />
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Message spacing and shape</legend>
          {Object.entries(sliders).map(([key, [label, , min, max]]) => (
            <label key={key} className="designPlaygroundRange">
              <span>
                {label}{" "}
                <output>
                  {numbers[key]}
                  {key === "leading" ? "" : "px"}
                </output>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={key === "leading" ? 0.1 : 1}
                value={numbers[key]}
                onChange={(event) => {
                  setNumbers({ ...numbers, [key]: Number(event.target.value) });
                  setEnabled(true);
                }}
              />
            </label>
          ))}
        </fieldset>
        <p>
          Some existing controls retain their own colors. Check text contrast,
          hover states and open dialogs before adopting a palette.
        </p>
        <footer>
          <button
            onClick={() => {
              setEnabled(false);
              setPalette(initialColors);
              setNumbers(initialNumbers);
            }}
          >
            Reset original
          </button>
          <button onClick={exportCss}>Export CSS</button>
        </footer>
      </aside>
    </>
  );
}
