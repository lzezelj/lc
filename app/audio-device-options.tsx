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
}) {
  return (
    <div className="audioDeviceOptions">
      {mode !== "input" && (
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
      {mode !== "output" && (
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
      {mode !== "input" && (
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
