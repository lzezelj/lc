"use client";
import { LoadingSkeleton } from "./loading-skeleton";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { monitorVoiceActivity, prepareVoiceActivity } from "./voice-activity";
import { applyCallOutput } from "./audio-output";
import {
  SoundPlayer,
  SoundCooldown,
  type PublishSound,
} from "./soundboard-audio";

import { loadSoundAudio, type Sound } from "./soundboard-library";
import { SoundPreviewIcon, SoundUploadDialog } from "./sound-manager";

export function useSoundboard(
  callId: string,
  options: {
    outputVolume?: number;
    outputId?: string;
    deafened?: boolean;
    onSpeakingChange?: (speaking: boolean) => void;
  } = {},
) {
  const player = useRef<SoundPlayer | null>(null);
  const preview = useRef<SoundPlayer | null>(null);
  const localAudio = useRef<HTMLAudioElement | null>(null);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const activity = useRef(options.onSpeakingChange);
  const [openCall, setOpenCall] = useState<string | null>(null);
  const open = openCall === callId;
  const setOpen = useCallback(
    (value: boolean) => setOpenCall(value ? callId : null),
    [callId],
  );
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const cooldown = useRef(new SoundCooldown());
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playBlocked, setPlayBlocked] = useState(false);
  useEffect(
    () => () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    },
    [],
  );
  function reservePlay() {
    if (!cooldown.current.take()) return false;
    setPlayBlocked(true);
    cooldownTimer.current = setTimeout(() => setPlayBlocked(false), 1000);
    return true;
  }
  useEffect(() => {
    activity.current = options.onSpeakingChange;
  });
  useEffect(() => {
    const current = new SoundPlayer((track) =>
      monitorVoiceActivity(track, (speaking) => activity.current?.(speaking)),
    );
    const localPreview = new SoundPlayer();
    player.current = current;
    preview.current = localPreview;
    const audio = document.createElement("audio");
    const audition = document.createElement("audio");
    audio.dataset.lcSoundboardLocal = "playback";
    audition.dataset.lcSoundboardLocal = "preview";
    audio.hidden = audition.hidden = true;
    document.body.append(audio, audition);
    localAudio.current = audio;
    previewAudio.current = audition;
    return () => {
      current.stop();
      localPreview.stop();
      audio.srcObject = audition.srcObject = null;
      audio.remove();
      audition.remove();
    };
  }, [callId]);
  useEffect(() => {
    for (const audio of [localAudio.current, previewAudio.current]) {
      if (audio)
        void applyCallOutput(
          audio,
          ((options.outputVolume ?? 100) * volume) / 100,
          muted || Boolean(options.deafened),
          options.outputId ?? "",
        ).catch(() => {});
    }
  }, [
    callId,
    volume,
    muted,
    options.outputVolume,
    options.outputId,
    options.deafened,
  ]);
  async function listen(track: MediaStreamTrack, audition: boolean) {
    const audio = audition ? previewAudio.current : localAudio.current;
    if (!audio) throw new Error("Soundboard output unavailable");
    const stream = new MediaStream([track]);
    audio.srcObject = stream;
    try {
      await audio.play();
    } catch (error) {
      audio.srcObject = null;
      throw error;
    }
    return () => {
      if (audio.srcObject === stream) audio.srcObject = null;
    };
  }
  return {
    player,
    preview,
    listen,
    open,
    setOpen,
    volume,
    setVolume,
    muted,
    setMuted,
    playBlocked,
    reservePlay,
    previewOutput: {
      outputVolume: ((options.outputVolume ?? 100) * volume) / 100,
      outputId: options.outputId,
      deafened: muted || Boolean(options.deafened),
    },
  };
}

export function SoundboardButton({
  board,
  serverId,
  serverName,
  disabled,
  publish,
}: {
  board: ReturnType<typeof useSoundboard>;
  serverId?: string;
  serverName?: string;
  disabled: boolean;
  publish: PublishSound;
}) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const loading = loadedFor !== serverId;
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [search, setSearch] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();
  const { open, setOpen } = board;
  useEffect(() => {
    if (!open || uploadOpen) return;
    const close = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, setOpen, uploadOpen]);
  useEffect(() => {
    if (!board.open || !serverId) return;
    const abort = new AbortController();
    void fetch(`/api/servers/${serverId}/soundboard`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Could not load this server's soundboard");
        return response.json() as Promise<{
          sounds: Sound[];
          canManage: boolean;
        }>;
      })
      .then((items) => {
        if (!abort.signal.aborted) {
          setSounds(items.sounds);
          setCanManage(items.canManage);
          setError("");
          setLoadedFor(serverId);
        }
      })
      .catch((error: Error) => {
        if (!abort.signal.aborted) {
          setError(error.message);
          setSounds([]);
          setCanManage(false);
          setLoadedFor(serverId);
        }
      });
    return () => abort.abort();
  }, [board.open, serverId]);
  async function play(sound: Sound, audition = false) {
    const context = prepareVoiceActivity();
    const player = audition ? board.preview.current : board.player.current;
    if (!player || sound.serverId !== serverId) return;
    if (!audition && !board.reservePlay()) return;
    setPlaying(true);
    setError("");
    try {
      await player.play(
        context,
        () => loadSoundAudio(serverId, sound.id),
        async (track) => {
          if (audition) return board.listen(track, true);
          const permit = await fetch(
            `/api/servers/${serverId}/soundboard/play?clip=${encodeURIComponent(sound.id)}`,
            { method: "POST" },
          );
          if (!permit.ok) {
            const result = await permit.json();
            throw new Error(result.error ?? "The sound could not be played");
          }
          const unpublish = await publish(track);
          try {
            const stopListening = await board.listen(track, false);
            return () => {
              stopListening();
              unpublish();
            };
          } catch (error) {
            unpublish();
            throw error;
          }
        },
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The sound could not be played. Try again.",
      );
    } finally {
      setPlaying(false);
    }
  }
  const query = search.trim().toLowerCase();
  const visibleSounds =
    open && !loading
      ? sounds.filter(
          (sound) =>
            sound.serverId === serverId &&
            sound.name.toLowerCase().includes(query),
        )
      : [];
  return (
    <>
      <button
        className="soundboardButton"
        ref={trigger}
        aria-expanded={board.open}
        aria-controls={panelId}
        disabled={disabled || !serverId}
        title={
          serverId
            ? "Open the active call's server soundboard"
            : "Soundboards are available in server calls"
        }
        onClick={() => {
          setError("");
          board.setOpen(!board.open);
        }}
      >
        Soundboard
      </button>
      {board.open && serverId && (
        <section
          ref={panel}
          id={panelId}
          className="soundboardDropup"
          aria-label={`Soundboard${serverName ? ` — ${serverName}` : ""}`}
        >
          <header>
            <strong>Soundboard</strong>
            <small>{serverName}</small>
          </header>
          <input
            type="search"
            className="soundboardSearch"
            aria-label="Search sounds"
            placeholder="Search sounds"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="soundboardClips" aria-busy={loading}>
            {loading && <LoadingSkeleton kind="sounds" />}
            {!loading &&
              visibleSounds.map((sound) => (
                <div className="soundboardClip" key={sound.id}>
                  <button
                    className="soundboardPlay"
                    disabled={disabled || playing || board.playBlocked}
                    aria-label={`Play ${sound.name} for everyone`}
                    title={
                      board.playBlocked
                        ? "One sound per second"
                        : "Play for everyone"
                    }
                    onClick={() => void play(sound)}
                  >
                    {sound.name}
                  </button>
                  <div className="soundboardClipActions">
                    <button
                      disabled={playing}
                      aria-label={`Preview ${sound.name}`}
                      title="Preview only for you"
                      onClick={() => void play(sound, true)}
                    >
                      <SoundPreviewIcon />
                    </button>
                  </div>
                </div>
              ))}
          </div>
          {!loading && !error && sounds.length === 0 && (
            <p className="soundboardEmpty">
              No sounds yet.{" "}
              {canManage
                ? "Add your first custom sound below."
                : "Ask the server owner to add sounds."}
            </p>
          )}
          {!loading &&
            !error &&
            sounds.length > 0 &&
            visibleSounds.length === 0 && (
              <p className="soundboardEmpty">No sounds match your search.</p>
            )}
          {!loading && canManage && (
            <button
              type="button"
              className="soundboardAdd"
              onClick={() => setUploadOpen(true)}
            >
              Add custom sound
            </button>
          )}
          <div className="soundboardVolume">
            <button
              aria-label={board.muted ? "Unmute soundboard" : "Mute soundboard"}
              title={board.muted ? "Unmute soundboard" : "Mute soundboard"}
              aria-pressed={board.muted}
              onClick={() => board.setMuted(!board.muted)}
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="M11 5 6 9H3v6h3l5 4Z" />
                {board.muted ? (
                  <path d="m16 9 6 6m0-6-6 6" />
                ) : (
                  <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
                )}
              </svg>
            </button>
            <label>
              <span className="srOnly">Soundboard volume</span>
              <input
                aria-label="Soundboard volume"
                type="range"
                min="0"
                max="100"
                value={board.volume}
                onChange={(event) =>
                  board.setVolume(Number(event.target.value))
                }
              />{" "}
              {board.volume}%
            </label>
          </div>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {uploadOpen && serverId && (
        <SoundUploadDialog
          key={serverId}
          serverId={serverId}
          output={board.previewOutput}
          onClose={() => setUploadOpen(false)}
          onSaved={(sound) => {
            setSounds((current) => [...current, sound]);
            setSearch("");
          }}
        />
      )}
    </>
  );
}
