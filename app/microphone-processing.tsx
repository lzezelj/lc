"use client";
import { useEffect, useState } from "react";
import { InformationHint } from "./information-hint";
import { SwitchControl } from "./switch-control";
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
        <span className="settingsFieldLabel">
          Microphone processing{" "}
          <InformationHint text="Raw bypasses noise suppression, echo cancellation, automatic gain and the transmission threshold. Browser uses browser processing; RNNoise uses a neural filter and falls back to browser processing if unavailable. Volume and mute/deafen apply in every mode. RNNoise notices are under Licenses in the app footer." />
        </span>
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
    <SwitchControl
      className="rnnoiseToggle"
      checked={mode !== "raw" && enabled}
      disabled={mode === "raw"}
      onChange={saveEchoCancellationEnabled}
      label={
        <span className="settingsFieldLabel">
          Echo cancellation{" "}
          <InformationHint text="Reduces speaker sound returning through your microphone. Try disabling it if it clips speech. Unavailable in Raw mode." />
        </span>
      }
    />
  );
}
