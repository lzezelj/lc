"use client";

import { useEffect, useRef, useState } from "react";
import { createMicrophoneGate, readVoiceThreshold } from "./microphone-gate";
import { microphoneProcessing, prepareVoiceActivity } from "./voice-activity";

export function MediaTests({
  microphoneId,
  cameraId,
}: {
  microphoneId: string;
  cameraId: string;
}) {
  const [threshold, setThreshold] = useState(readVoiceThreshold);
  const [micTesting, setMicTesting] = useState(false);
  const [cameraTesting, setCameraTesting] = useState(false);
  const [level, setLevel] = useState(-80);
  const [transmitting, setTransmitting] = useState(false);
  const [listen, setListen] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);

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
        );
        if (playback) playback.srcObject = new MediaStream([gate.track]);
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
      if (playback) playback.srcObject = null;
    };
  }, [micTesting, microphoneId]);

  useEffect(() => {
    if (!cameraTesting) return;
    let cancelled = false;
    let captured: MediaStream | undefined;
    const preview = video.current;
    void navigator.mediaDevices
      .getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
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
  }, [cameraTesting, cameraId]);

  return (
    <div className="mediaTests">
      <label htmlFor="voiceThreshold">
        Voice transmission threshold:{" "}
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
        Move right to block quieter sounds. Applies immediately to calls and
        this test. Loud background speech can still pass, especially while you
        speak.
      </small>
      <small>
        Start the microphone test, stay quiet, then speak normally. Set the
        threshold above the room noise level but below your speaking level.
      </small>
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
          <label className="listenTest">
            <input
              type="checkbox"
              checked={listen}
              onChange={(event) => {
                setListen(event.target.checked);
                if (event.target.checked)
                  void audio.current
                    ?.play()
                    .catch(() =>
                      setError(
                        "Playback was blocked. Try enabling playback again.",
                      ),
                    );
              }}
            />{" "}
            Hear my microphone (use headphones)
          </label>
        </>
      )}
      <audio ref={audio} autoPlay muted={!listen || !micTesting} />
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
          ref={video}
          autoPlay
          muted
          playsInline
        />
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
