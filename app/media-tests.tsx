"use client";
import {
  cameraCaptureConstraints,
  type CameraResolution,
} from "./camera-resolution";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createMicrophoneGate, readVoiceThreshold } from "./microphone-gate";
import {
  MicrophoneModeSelector,
  EchoCancellationToggle,
} from "./microphone-processing";
import { microphoneProcessing, prepareVoiceActivity } from "./voice-activity";
import { applyCallOutput } from "./audio-output";
import { revealSettingsSection } from "./settings-reveal";

export function MediaTests({
  microphoneId,
  cameraId,
  cameraResolution = "720",
  outputVolume = 100,
  outputId = "",
  deafened = false,
  audioDevices,
  cameraDevices,
}: {
  microphoneId: string;
  cameraId: string;
  cameraResolution?: CameraResolution;
  outputVolume?: number;
  outputId?: string;
  deafened?: boolean;
  audioDevices?: ReactNode;
  cameraDevices?: ReactNode;
}) {
  const [threshold, setThreshold] = useState(readVoiceThreshold);
  const [micTesting, setMicTesting] = useState(false);
  const [cameraTesting, setCameraTesting] = useState(false);
  const [level, setLevel] = useState(-80);
  const [transmitting, setTransmitting] = useState(false);
  const [suppression, setSuppression] = useState("browser");
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const cameraSection = useRef<HTMLElement>(null);
  const microphoneSection = useRef<HTMLElement>(null);
  useEffect(() => {
    if (cameraTesting) revealSettingsSection(cameraSection.current);
  }, [cameraTesting]);
  useEffect(() => {
    if (micTesting) revealSettingsSection(microphoneSection.current);
  }, [micTesting]);

  useEffect(() => {
    if (audio.current)
      void applyCallOutput(
        audio.current,
        outputVolume,
        deafened || !micTesting,
        outputId,
      ).catch(() => setError("Could not use the selected playback device."));
  }, [outputVolume, outputId, deafened, micTesting]);

  useEffect(() => {
    if (!micTesting) return;
    let cancelled = false;
    let captured: MediaStream | undefined;
    let gate: ReturnType<typeof createMicrophoneGate> | undefined;
    const playback = audio.current;
    const context = prepareVoiceActivity();
    void navigator.mediaDevices
      .getUserMedia({
        audio: {
          ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
          channelCount: 1,
          sampleRate: 48_000,
          ...microphoneProcessing(),
        },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        captured = stream;
        gate = createMicrophoneGate(
          stream.getAudioTracks()[0],
          context,
          (db, open) => {
            setLevel(db);
            setTransmitting(open);
          },
          setSuppression,
        );
        if (playback) {
          playback.srcObject = new MediaStream([gate.track]);
          void playback.play().catch(() => {
            if (!cancelled)
              setError(
                "Microphone playback was blocked. Stop and start the test to try again.",
              );
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not test the microphone. Check device permissions.");
          setMicTesting(false);
        }
      });
    return () => {
      cancelled = true;
      gate?.stop();
      captured?.getTracks().forEach((track) => track.stop());
      if (playback) {
        playback.pause();
        playback.srcObject = null;
      }
    };
  }, [micTesting, microphoneId]);

  useEffect(() => {
    if (!cameraTesting) return;
    let cancelled = false;
    let captured: MediaStream | undefined;
    const preview = video.current;
    void navigator.mediaDevices
      .getUserMedia({
        video: cameraCaptureConstraints(cameraId, cameraResolution),
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        captured = stream;
        if (preview) preview.srcObject = stream;
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not test the camera. Check device permissions.");
          setCameraTesting(false);
        }
      });
    return () => {
      cancelled = true;
      captured?.getTracks().forEach((track) => track.stop());
      if (preview) preview.srcObject = null;
    };
  }, [cameraTesting, cameraId, cameraResolution]);

  return (
    <div className="mediaTests">
      <section className="mediaSettingsGroup" aria-label="Audio settings">
        <h4>Audio</h4>
        {audioDevices}
        <MicrophoneModeSelector />
        <EchoCancellationToggle />
        <small>
          Echo cancellation reduces speaker sound returning through the
          microphone. Try disabling it if it clips speech.
        </small>
        <small>
          Raw bypasses LC noise suppression, echo cancellation, automatic gain
          and the transmission threshold. Browser uses browser processing;
          RNNoise uses the neural filter. Volume and mute/deafen apply in every
          mode.
        </small>
        <small>
          Noise suppression powered by RNNoise. Full third-party notices are
          available under Licenses in the app footer.
        </small>
        <p className="settingsDescription">
          Browser processing is used if RNNoise is unavailable.{" "}
          {micTesting &&
            `Active processing: ${suppression === "rnnoise" ? "RNNoise" : suppression === "raw" ? "Raw" : "Browser"}.`}
        </p>
        <label htmlFor="voiceThreshold">
          Browser-mode transmission threshold:{" "}
          {threshold <= -80 ? "Off (always transmit)" : `${threshold} dB`}
        </label>
        <input
          id="voiceThreshold"
          type="range"
          min="-80"
          max="0"
          step="1"
          value={threshold}
          onChange={(event) => {
            const next = Number(event.target.value);
            localStorage.setItem("lc.voiceThreshold", String(next));
            setThreshold(next);
          }}
        />
        <small>
          Applies when using browser suppression. RNNoise runs without an
          additional loudness cutoff to preserve quiet speech.
        </small>
        <small>
          Start the microphone test, stay quiet, then speak normally. Set the
          threshold above the room noise level but below your speaking level
          when using browser suppression. Avoid stacking RNNoise with noise
          removal from another app.
        </small>
        <section className="mediaTestSection" ref={microphoneSection}>
          <button
            type="button"
            onClick={() => {
              prepareVoiceActivity();
              setError("");
              setMicTesting((current) => !current);
            }}
          >
            {micTesting ? "Stop microphone test" : "Test microphone"}
          </button>
          {micTesting && (
            <>
              <meter
                aria-label="Microphone input level"
                min="-80"
                max="0"
                value={level}
              />
              <span role="status">
                {Math.round(level)} dB ·{" "}
                {transmitting ? "Passing audio" : "Blocked by threshold"}
              </span>
            </>
          )}
          <audio ref={audio} autoPlay muted={deafened || !micTesting} />
        </section>
      </section>
      <section className="mediaSettingsGroup" aria-label="Camera settings">
        <h4>Camera</h4>
        {cameraDevices}
        <section className="mediaTestSection" ref={cameraSection}>
          <button
            type="button"
            onClick={() => {
              setError("");
              setCameraTesting((current) => !current);
            }}
          >
            {cameraTesting ? "Stop camera test" : "Test camera"}
          </button>
          {cameraTesting && (
            <video
              className="settingsCameraPreview"
              onLoadedMetadata={() =>
                revealSettingsSection(cameraSection.current)
              }
              ref={video}
              autoPlay
              muted
              playsInline
            />
          )}
        </section>
      </section>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
