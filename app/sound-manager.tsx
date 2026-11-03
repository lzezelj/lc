"use client";

import { useEffect, useRef, useState } from "react";
import { SettingsModal } from "./settings-modal";
import { applyCallOutput } from "./audio-output";
import { loadSoundAudio, type Sound } from "./soundboard-library";

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

function LocalSoundPreview({
  sound,
  file,
  output = {},
}: {
  sound?: Sound;
  file?: File;
  output?: SoundPreviewOutput;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState("");
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
  const [saved, setSaved] = useState<Sound | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || saving || saved) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Sound must be at most 2 MiB");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/servers/${serverId}/soundboard?name=${encodeURIComponent(name.trim())}`,
        {
          method: "POST",
          headers: { "Content-Type": "audio/wav" },
          body: file,
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
        <p>16-bit PCM WAV · up to 10 seconds · 2 MiB · 20 per server</p>
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
          WAV file
          <input
            required
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            aria-label="Sound file"
            disabled={saving}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null;
              setSaved(null);
              setError("");
              if (selected && selected.size > 2 * 1024 * 1024) {
                setFile(null);
                setError("Sound must be at most 2 MiB");
                return;
              }
              setFile(selected);
              if (selected)
                setName(selected.name.replace(/\.wav$/i, "").slice(0, 60));
            }}
          />
        </label>
        {saved ? (
          <>
            <p role="status">Sound added. Preview your uploaded sound below.</p>
            <LocalSoundPreview key={saved.id} sound={saved} output={output} />
          </>
        ) : (
          file && (
            <LocalSoundPreview
              key={`${file.name}-${file.lastModified}`}
              file={file}
              output={output}
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
            disabled={saving || !file || !name.trim() || Boolean(saved)}
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
}: {
  serverId: string;
  output?: SoundPreviewOutput;
}) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<Sound | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/servers/${serverId}/soundboard`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load soundboard");
        return response.json() as Promise<{
          sounds: Sound[];
          canManage: boolean;
        }>;
      })
      .then((result) => {
        if (!abort.signal.aborted) {
          setSounds(result.sounds);
          setCanManage(result.canManage);
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
  }, [serverId]);
  async function remove(sound: Sound) {
    if (removing) return;
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
  return (
    <section className="soundManager" aria-label="Manage soundboard">
      <h3>Soundboard</h3>
      <p>Add sounds for everyone in this server. Previews play only for you.</p>
      {canManage && (
        <button type="button" onClick={() => setUploadOpen(true)}>
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
                {sound.name}
                {sound.durationMs ? (
                  <small>{(sound.durationMs / 1000).toFixed(1)} seconds</small>
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
                  disabled={Boolean(removing)}
                  aria-label={`Remove ${sound.name}`}
                  onClick={() => void remove(sound)}
                >
                  {removing === sound.id ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          ))}
          {visible.length === 0 && (
            <p>No sounds{search.trim() ? " match your search." : " yet."}</p>
          )}
        </div>
      )}
      {preview && (
        <LocalSoundPreview key={preview.id} sound={preview} output={output} />
      )}
      {error && <p role="alert">{error}</p>}
      {uploadOpen && (
        <SoundUploadDialog
          serverId={serverId}
          output={output}
          onClose={() => setUploadOpen(false)}
          onSaved={(sound) => setSounds((current) => [...current, sound])}
        />
      )}
    </section>
  );
}
