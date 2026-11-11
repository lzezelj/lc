"use client";

import type { MediaDeviceOption } from "./device-menu";
import { DeviceSelection } from "./device-selection";

export function AudioDeviceOptions({
  outputs,
  outputId,
  outputSupported,
  microphoneVolume,
  outputVolume,
  onOutputChange,
  onMicrophoneVolumeChange,
  onOutputVolumeChange,
  mode = "both",
  controls = "all",
}: {
  outputs: MediaDeviceOption[];
  outputId: string;
  outputSupported: boolean;
  microphoneVolume: number;
  outputVolume: number;
  onOutputChange: (id: string) => void;
  onMicrophoneVolumeChange: (value: number) => void;
  onOutputVolumeChange: (value: number) => void;
  mode?: "input" | "output" | "both";
  controls?: "all" | "devices" | "levels";
}) {
  return (
    <div className="audioDeviceOptions">
      {mode !== "input" && controls !== "levels" && (
        <DeviceSelection
          label="Headphones / speakers"
          devices={outputs}
          selectedId={outputId}
          disabled={!outputSupported}
          onSelect={onOutputChange}
          note={
            !outputSupported
              ? "This browser uses your system’s output device. Output volume still works."
              : undefined
          }
        />
      )}
      {mode !== "output" && controls !== "devices" && (
        <label>
          Microphone volume: {microphoneVolume}%
          <input
            type="range"
            min="0"
            max="100"
            value={microphoneVolume}
            onChange={(event) =>
              onMicrophoneVolumeChange(Number(event.target.value))
            }
          />
        </label>
      )}
      {mode !== "input" && controls !== "devices" && (
        <label>
          Output volume: {outputVolume}%
          <input
            type="range"
            min="0"
            max="100"
            value={outputVolume}
            onChange={(event) =>
              onOutputVolumeChange(Number(event.target.value))
            }
          />
        </label>
      )}
    </div>
  );
}
