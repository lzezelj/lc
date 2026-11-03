"use client";

import { useState } from "react";
import { SettingsModal } from "./settings-modal";

export const screenShareResolutions = {
  "720": { width: 1280, height: 720, frameRate: 30 },
  "1080": { width: 1920, height: 1080, frameRate: 30 },
  "1440": { width: 2560, height: 1440, frameRate: 30 },
  "2160": { width: 3840, height: 2160, frameRate: 30 },
};
export type ScreenShareResolution = keyof typeof screenShareResolutions;

export function ScreenShareOptions({
  onShare,
  onClose,
}: {
  onShare: (resolution: ScreenShareResolution) => void;
  onClose: () => void;
}) {
  const [resolution, setResolution] = useState<ScreenShareResolution>("1080");
  return (
    <SettingsModal title="Share your screen" onClose={onClose}>
      <form
        className="screenShareOptions"
        onSubmit={(event) => {
          event.preventDefault();
          onShare(resolution);
        }}
      >
        <div className="deviceSelection">
          <label>
            <span className="resolutionLabel">
              Resolution{" "}
              <button
                className="resolutionHelp"
                type="button"
                aria-label="About sharing resolution"
                title="4K sharing requires a source with at least 3840×2160 pixels. Choosing 4K does not add detail to a 1080p screen or smaller window. Retina displays may capture more pixels than their logical desktop size."
              >
                i
              </button>
            </span>
            <select
              value={resolution}
              onChange={(event) =>
                setResolution(event.target.value as ScreenShareResolution)
              }
            >
              <option value="720">720p — lower bandwidth</option>
              <option value="1080">1080p — recommended</option>
              <option value="1440">1440p</option>
              <option value="2160">4K (2160p)</option>
            </select>
          </label>
        </div>
        <p className="settingsDescription">
          To share sound, enable Share audio in the browser picker. Tab, window
          and system audio availability depends on your browser and operating
          system.
        </p>
        <p className="settingsDescription">
          Up to the selected resolution at 30 fps. Quality also depends on the
          shared window, browser and connection. Next, choose what to share.
        </p>
        <div className="modalActions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Choose screen
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}
