"use client";
import { SettingsSection } from "./settings-section";
import { InformationHint } from "./information-hint";

import { useEffect, useMemo, useRef, useState } from "react";
import { SettingsModal } from "./settings-modal";
import { applyCallOutput } from "./audio-output";
import {
  loadSoundAudio,
  useSoundboardRefresh,
  type Sound,
} from "./soundboard-library";
import {
  decodeSoundFile,
  adjustSoundTrim,
  maxSoundSourceBytes,
  soundTrimLimitSeconds,
  trimSoundWave,
} from "./sound-trim";

export type SoundPreviewOutput = {
  outputVolume?: number;
  outputId?: string;
  deafened?: boolean;
};

export function SoundPreviewIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M4 14v-3a8 8 0 0 1 16 0v3M4 13h3v8H4zM17 13h3v8h-3z" />
    </svg>
  );
}

function SoundTrimTrack({
  source,
  start,
  end,
  onChange,
  onCommit,
}: {
  source: AudioBuffer;
  start: number;
  end: number;
  onChange: (boundary: "start" | "end" | "selection", value: number) => void;
  onCommit: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const peaks = useMemo(() => {
    const samples = source.getChannelData(0);
    return Array.from({ length: 120 }, (_, index) => {
      const from = Math.floor((index * samples.length) / 120);
      const to = Math.floor(((index + 1) * samples.length) / 120);
      let peak = 0;
      for (
        let i = from;
        i < to;
        i += Math.max(1, Math.floor((to - from) / 100))
      )
        peak = Math.max(peak, Math.abs(samples[i]));
      return Math.max(2, peak * 64);
    });
  }, [source]);
  function move(
    event: React.PointerEvent<HTMLButtonElement>,
    boundary: "start" | "end" | "selection",
  ) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const bounds = track.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    if (!drag.current) return;
    const value =
      drag.current.value +
      ((event.clientX - drag.current.x) / bounds.width) * source.duration;
    onChange(boundary, value);
  }
  function keyboard(
    event: React.KeyboardEvent,
    boundary: "start" | "end" | "selection",
  ) {
    const current = boundary === "end" ? end : start;
    const step = event.shiftKey ? 1 : 0.01;
    const value =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? source.duration
          : event.key === "ArrowLeft" || event.key === "ArrowDown"
            ? current - step
            : event.key === "ArrowRight" || event.key === "ArrowUp"
              ? current + step
              : null;
    if (value === null) return;
    event.preventDefault();
    onChange(boundary, value);
  }
  return (
    <>
      <p>
        Drag the edges to trim, or drag between them to move the clip. Maximum
        10 seconds.
      </p>
      <div
        className="soundTrimTrack"
        ref={track}
        data-dragging={dragging || undefined}
      >
        <svg viewBox="0 0 360 80" preserveAspectRatio="none" aria-hidden="true">
          {peaks.map((height, i) => (
            <rect
              key={i}
              x={i * 3}
              y={(80 - height) / 2}
              width="2"
              height={height}
              rx="1"
            />
          ))}
        </svg>
        {(["selection", "start", "end"] as const).map((boundary) => (
          <button
            type="button"
            key={boundary}
            className={
              boundary === "selection"
                ? "soundTrimSelection"
                : `soundTrimHandle ${boundary}`
            }
            style={
              boundary === "selection"
                ? {
                    left: `${(start / source.duration) * 100}%`,
                    width: `${((end - start) / source.duration) * 100}%`,
                  }
                : {
                    left: `${((boundary === "start" ? start : end) / source.duration) * 100}%`,
                  }
            }
            role="slider"
            aria-label={
              boundary === "selection"
                ? "Move selected clip"
                : `Trim ${boundary} position`
            }
            aria-valuemin={0}
            aria-valuemax={source.duration}
            aria-valuenow={boundary === "end" ? end : start}
            aria-valuetext={`${(boundary === "end" ? end : start).toFixed(2)} seconds`}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragging(true);
              drag.current = {
                x: event.clientX,
                value: boundary === "end" ? end : start,
              };
            }}
            onPointerMove={(event) => move(event, boundary)}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              drag.current = null;
              setDragging(false);
              onCommit();
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragging(false);
            }}
            onLostPointerCapture={() => setDragging(false)}
            onKeyDown={(event) => keyboard(event, boundary)}
            onKeyUp={(event) => {
              if (
                [
                  "Home",
                  "End",
                  "ArrowLeft",
                  "ArrowRight",
                  "ArrowUp",
                  "ArrowDown",
                ].includes(event.key)
              )
                onCommit();
            }}
          >
            <span
              aria-hidden="true"
              className={
                boundary === "selection" ? "soundTrimGrip" : "soundTrimEdge"
              }
            >
              {boundary === "selection" ? "↔" : null}
            </span>
          </button>
        ))}
      </div>
      <div className="soundTrimTimes">
        <span>0:00</span>
        <span>{source.duration.toFixed(2)} s</span>
      </div>
    </>
  );
}

function LocalSoundPreview({
  sound,
  file,
  output = {},
  previewRequest = 0,
}: {
  sound?: Sound;
  file?: File;
  output?: SoundPreviewOutput;
  previewRequest?: number;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
  const playedRequest = useRef(0);
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    let active = true,
      url = "";
    void (
      file
        ? Promise.resolve(file)
        : sound
          ? loadSoundAudio(sound.serverId, sound.id).then(
              (bytes) => new Blob([bytes], { type: "audio/wav" }),
            )
          : Promise.reject(new Error("Choose a sound"))
    )
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        element.src = url;
      })
      .catch(() => {
        if (active) setError("The sound could not be previewed.");
      });
    return () => {
      active = false;
      element.pause();
      element.removeAttribute("src");
      element.load();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, sound]);
  useEffect(() => {
    if (audio.current)
      void applyCallOutput(
        audio.current,
        output.outputVolume ?? 100,
        Boolean(output.deafened),
        output.outputId ?? "",
      ).catch(() => setError("The selected audio output could not be opened."));
  }, [output.outputVolume, output.deafened, output.outputId]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !previewRequest || playedRequest.current === previewRequest)
      return;
    let active = true;
    const play = () => {
      if (playedRequest.current === previewRequest) return;
      playedRequest.current = previewRequest;
      void applyCallOutput(
        element,
        output.outputVolume ?? 100,
        Boolean(output.deafened),
        output.outputId ?? "",
      )
        .then(() => {
          if (!active) return;
          element.currentTime = 0;
          return element.play();
        })
        .catch(() => {
          /* Manual Play remains available if autoplay is blocked. */
        });
    };
    if (element.readyState >= 1) play();
    else element.addEventListener("loadedmetadata", play, { once: true });
    return () => {
      active = false;
      element.removeEventListener("loadedmetadata", play);
    };
  }, [previewRequest, output.outputVolume, output.deafened, output.outputId]);
  return (
    <div className="soundLocalPreview">
      <audio
        ref={audio}
        controls
        preload="metadata"
        aria-label={sound ? `Preview ${sound.name}` : "Preview selected sound"}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function TrimSecondsInput({
  label,
  value,
  duration,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  duration: number;
  onChange: (value: number) => void;
  onCommit: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label>
      {label} (seconds)
      <input
        type="number"
        aria-label={`Trim ${label.toLowerCase()} seconds`}
        min={0}
        max={Math.ceil(duration * 100) / 100}
        step="0.01"
        value={draft ?? value.toFixed(2)}
        onChange={(event) => {
          const text = event.target.value;
          if (!/^\d*(?:\.\d{0,2})?$/.test(text)) return;
          setDraft(text);
          onChange(event.target.valueAsNumber || 0);
        }}
        onBlur={() => {
          setDraft(null);
          onCommit();
        }}
      />
    </label>
  );
}

export function SoundUploadDialog({
  serverId,
  onClose,
  onSaved,
  output,
}: {
  serverId: string;
  onClose: () => void;
  onSaved: (sound: Sound) => void;
  output?: SoundPreviewOutput;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<AudioBuffer | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [saved, setSaved] = useState<Sound | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [previewOnStartChange, setPreviewOnStartChange] = useState(true);
  const [previewRequest, setPreviewRequest] = useState(0);
  const previewSequence = useRef(0);
  const committedStart = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    if (!file) return;
    let current = true;
    void decodeSoundFile(file)
      .then((buffer) => {
        if (!current) return;
        setSource(buffer);
        setStart(0);
        committedStart.current = 0;
        setEnd(Math.min(soundTrimLimitSeconds, buffer.duration));
      })
      .catch((error: Error) => {
        if (current) setError(error.message);
      })
      .finally(() => {
        if (current) setDecoding(false);
      });
    return () => {
      current = false;
    };
  }, [file]);
  const selection = useMemo(() => {
    if (!source || !file) return null;
    try {
      return {
        file: new File([trimSoundWave(source, start, end)], "trimmed.wav", {
          type: "audio/wav",
        }),
        error: "",
      };
    } catch (error) {
      return { file: null, error: (error as Error).message };
    }
  }, [source, file, start, end]);
  function changeTrim(boundary: "start" | "end" | "selection", value: number) {
    if (!source) return;
    const next = adjustSoundTrim(source.duration, start, end, boundary, value);
    setStart(next.start);
    setEnd(next.end);
    setPreviewRequest(0);
  }
  function commitTrim() {
    const changed = Math.abs(start - committedStart.current) > 1e-9;
    committedStart.current = start;
    if (changed && previewOnStartChange)
      setPreviewRequest(++previewSequence.current);
  }
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection?.file || decoding || saving || saved) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/servers/${serverId}/soundboard?name=${encodeURIComponent(name.trim())}`,
        {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: selection.file,
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not upload sound");
      if (!active.current) return;
      setSaved(result as Sound);
      onSaved(result as Sound);
    } catch (error) {
      if (active.current)
        setError(
          error instanceof Error ? error.message : "Could not upload sound",
        );
    } finally {
      if (active.current) setSaving(false);
    }
  }
  return (
    <SettingsModal
      title="Add custom sound"
      onClose={onClose}
      className="soundUploadModal"
    >
      <form
        className="soundUploadForm"
        onSubmit={(event) => void upload(event)}
      >
        <p>
          Choose audio up to 25 MiB and 5 minutes. Trim to 10 seconds or less.
          Saved as WAV · up to 2 MiB · 20 per server.
        </p>
        <label>
          Name
          <input
            required
            maxLength={60}
            aria-label="Sound name"
            value={name}
            disabled={saving || Boolean(saved)}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Audio file
          <input
            required
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.webm"
            aria-label="Sound file"
            disabled={saving}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setSaved(null);
              setSource(null);
              setPreviewRequest(0);
              setDecoding(false);
              setError("");
              if (selected && selected.size > maxSoundSourceBytes) {
                setFile(null);
                setError("Choose an audio file up to 25 MiB.");
                return;
              }
              setDecoding(Boolean(selected));
              setFile(selected);
              if (selected)
                setName(selected.name.replace(/\.[^.]+$/, "").slice(0, 60));
            }}
          />
        </label>
        {decoding && <p role="status">Loading audio…</p>}
        {source && !saved && (
          <fieldset className="soundTrim" disabled={saving}>
            <legend>Trim sound</legend>
            <p>
              Source: {source.duration.toFixed(2)} seconds. Selection:{" "}
              {Math.max(0, end - start).toFixed(2)} seconds.
            </p>
            <SoundTrimTrack
              source={source}
              start={start}
              end={end}
              onChange={changeTrim}
              onCommit={commitTrim}
            />
            <div className="soundTrimNumbers">
              {(["Start", "End"] as const).map((label) => (
                <div className="soundTrimBoundary" key={label}>
                  <TrimSecondsInput
                    label={label}
                    value={label === "Start" ? start : end}
                    duration={source.duration}
                    onChange={(value) =>
                      changeTrim(label === "Start" ? "start" : "end", value)
                    }
                    onCommit={commitTrim}
                  />
                </div>
              ))}
            </div>
            <label className="soundPreviewToggle">
              <input
                type="checkbox"
                checked={previewOnStartChange}
                onChange={(event) => {
                  setPreviewOnStartChange(event.target.checked);
                  setPreviewRequest(0);
                }}
              />
              Preview after moving start
            </label>
            {selection?.error && <p role="alert">{selection.error}</p>}
          </fieldset>
        )}
        {saved ? (
          <>
            <p role="status">Sound added. Preview your uploaded sound below.</p>
            <LocalSoundPreview key={saved.id} sound={saved} output={output} />
          </>
        ) : (
          selection?.file && (
            <LocalSoundPreview
              file={selection.file}
              output={output}
              previewRequest={previewRequest}
            />
          )
        )}
        {error && <p role="alert">{error}</p>}
        <div className="modalActions">
          <button type="button" onClick={onClose}>
            {saved ? "Done" : "Cancel"}
          </button>
          <button
            type="submit"
            disabled={
              saving ||
              decoding ||
              !selection?.file ||
              !name.trim() ||
              Boolean(saved)
            }
          >
            {saving ? "Uploading…" : saved ? "Uploaded" : "Upload sound"}
          </button>
        </div>
      </form>
    </SettingsModal>
  );
}

export function SoundManager({
  serverId,
  output,
  joinSoundId = null,
  onJoinSoundChange,
  joinSoundOnly = false,
}: {
  serverId: string;
  output?: SoundPreviewOutput;
  joinSoundId?: string | null;
  onJoinSoundChange?: (soundId: string | null) => void;
  joinSoundOnly?: boolean;
}) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [canUpload, setCanUpload] = useState(false);
  const permissionVersion = useSoundboardRefresh(serverId);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<Sound | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  const [savingJoinSound, setSavingJoinSound] = useState(false);
  const [joinSoundSaved, setJoinSoundSaved] = useState(false);
  async function saveJoinSound(soundId: string) {
    if (savingJoinSound) return;
    setSavingJoinSound(true);
    setJoinSoundSaved(false);
    setError("");
    try {
      const response = await fetch(`/api/servers/${serverId}/join-sound`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          joinSoundId: soundId || null,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not save join sound");
      if (Object.hasOwn(result, "joinSoundId"))
        onJoinSoundChange?.(result.joinSoundId);
      setJoinSoundSaved(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save join sound",
      );
    } finally {
      setSavingJoinSound(false);
    }
  }
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/servers/${serverId}/soundboard`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load soundboard");
        return response.json() as Promise<{
          sounds: Sound[];
          canManage: boolean;
          canUpload?: boolean;
        }>;
      })
      .then((result) => {
        if (!abort.signal.aborted) {
          setSounds(result.sounds);
          setCanManage(result.canManage);
          setCanUpload(result.canUpload ?? result.canManage);
          if (!(result.canUpload ?? result.canManage)) setUploadOpen(false);
          setLoading(false);
        }
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) {
          setError(error.message);
          setLoading(false);
        }
      });
    return () => abort.abort();
  }, [serverId, permissionVersion]);
  async function remove(sound: Sound) {
    if (removing || savingJoinSound) return;
    setRemoving(sound.id);
    setError("");
    try {
      const response = await fetch(
        `/api/servers/${serverId}/soundboard?clip=${encodeURIComponent(sound.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Could not remove sound");
      }
      setSounds((current) => current.filter((item) => item.id !== sound.id));
      if (joinSoundId === sound.id) onJoinSoundChange?.(null);
      if (preview?.id === sound.id) setPreview(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not remove sound",
      );
    } finally {
      setRemoving("");
    }
  }
  const visible = sounds.filter((sound) =>
    sound.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const selectedSounds = sounds.filter((sound) => sound.id === joinSoundId);
  return (
    <SettingsSection
      className="soundManager"
      title={joinSoundOnly ? "Voice channel sounds" : "Soundboard"}
      hint={
        joinSoundOnly
          ? "Choose the soundboard sound everyone hears when you join a voice channel in this server. Previews play only for you."
          : "Add sounds for everyone in this server. Previews play only for you."
      }
    >
      {!loading && (
        <div className="deviceSelection">
          <label>
            <span className="settingsFieldLabel">
              Your voice channel join sound{" "}
              <InformationHint text="This choice is yours for this server only. Everyone in the channel hears your chosen sound when you join. Removing a selected sound restores Default." />
            </span>
            <select
              aria-label="Voice channel join sound"
              value={joinSoundId ?? ""}
              disabled={loading || savingJoinSound || Boolean(removing)}
              onChange={(event) => void saveJoinSound(event.target.value)}
            >
              <option value="">Default</option>
              {sounds.map((sound) => (
                <option key={sound.id} value={sound.id}>
                  {sound.name}
                </option>
              ))}
            </select>
          </label>
          {joinSoundSaved && (
            <small role="status">Join sound changed successfully</small>
          )}
        </div>
      )}
      {!joinSoundOnly && (
        <>
          {canUpload && (
            <button
              className="primary"
              type="button"
              onClick={() => setUploadOpen(true)}
            >
              Add custom sound
            </button>
          )}
          <input
            className="soundboardSearch"
            type="search"
            aria-label="Search managed sounds"
            placeholder="Search sounds"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading ? (
            <p role="status">Loading sounds…</p>
          ) : (
            <div className="soundManagerList">
              {visible.map((sound) => (
                <div className="soundManagerRow" key={sound.id}>
                  <span>
                    <span className="soundName" title={sound.name}>
                      {sound.name}
                    </span>
                    {sound.durationMs ? (
                      <small>
                        {(sound.durationMs / 1000).toFixed(1)} seconds
                      </small>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    className="soundPreviewButton"
                    aria-label={`Preview ${sound.name}`}
                    title="Preview only for you"
                    onClick={() => setPreview(sound)}
                  >
                    <SoundPreviewIcon />
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className="danger"
                      disabled={Boolean(removing) || savingJoinSound}
                      aria-label={`Remove ${sound.name}`}
                      onClick={() => void remove(sound)}
                    >
                      {removing === sound.id ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              ))}
              {visible.length === 0 && (
                <p>
                  No sounds{search.trim() ? " match your search." : " yet."}
                </p>
              )}
            </div>
          )}
          {preview && (
            <LocalSoundPreview
              key={preview.id}
              sound={preview}
              output={output}
            />
          )}
        </>
      )}
      {joinSoundOnly && loading && <p role="status">Loading sounds…</p>}
      {joinSoundOnly &&
        selectedSounds.map((sound) => (
          <LocalSoundPreview key={sound.id} sound={sound} output={output} />
        ))}
      {error && <p role="alert">{error}</p>}
      {uploadOpen && canUpload && !joinSoundOnly && (
        <SoundUploadDialog
          serverId={serverId}
          output={output}
          onClose={() => setUploadOpen(false)}
          onSaved={(sound) => setSounds((current) => [...current, sound])}
        />
      )}
    </SettingsSection>
  );
}
