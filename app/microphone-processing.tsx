"use client";
import { useEffect, useState } from "react";
import {
  readMicrophoneMode,
  saveMicrophoneMode,
  microphoneProcessingChanged,
  readEchoCancellationEnabled,
  saveEchoCancellationEnabled,
} from "./microphone-preferences.mjs";

export function MicrophoneModeSelector() {
  const [mode, setMode] = useState(readMicrophoneMode);
  useEffect(() => {
    const refresh = () => setMode(readMicrophoneMode());
    window.addEventListener(microphoneProcessingChanged, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(microphoneProcessingChanged, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return (
    <div className="deviceSelection">
      <label>
        Microphone processing
        <select
          aria-label="Microphone processing mode"
          value={mode}
          onChange={(event) =>
            saveMicrophoneMode(
              event.target.value as ReturnType<typeof readMicrophoneMode>,
            )
          }
        >
          <option value="raw">Raw</option>
          <option value="browser">Browser</option>
          <option value="rnnoise">RNNoise</option>
        </select>
      </label>
    </div>
  );
}
export function EchoCancellationToggle() {
  const [enabled, setEnabled] = useState(readEchoCancellationEnabled);
  const [mode, setMode] = useState(readMicrophoneMode);
  useEffect(() => {
    const refresh = () => {
      setEnabled(readEchoCancellationEnabled());
      setMode(readMicrophoneMode());
    };
    window.addEventListener(microphoneProcessingChanged, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(microphoneProcessingChanged, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return (
    <label className="rnnoiseToggle">
      <input
        type="checkbox"
        checked={mode !== "raw" && enabled}
        disabled={mode === "raw"}
        onChange={(event) => saveEchoCancellationEnabled(event.target.checked)}
      />
      <span>Echo cancellation</span>
    </label>
  );
}
