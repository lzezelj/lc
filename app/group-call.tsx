"use client";

import { RefObject, useEffect, useRef, useState } from "react";
import {
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Room,
  RoomEvent,
  Track,
} from "livekit-client";
import { DeviceMenu, MediaDeviceOption } from "./device-menu";
import { playVoiceSound } from "./call-sounds";

type TokenResponse = {
  server_url?: string;
  participant_token?: string;
  error?: string;
};

type RemoteMedia = {
  id: string;
  participantName: string;
  track: RemoteTrack;
};

type GroupCallProps = {
  channelId: string;
  currentUserName: string;
  microphoneId: string;
  cameraId: string;
  microphones: MediaDeviceOption[];
  cameras: MediaDeviceOption[];
  autoJoin?: boolean;
  viewOpen: boolean;
  onMicrophoneChange: (deviceId: string) => void;
  onCameraChange: (deviceId: string) => void;
  onConnectionChange: (present: boolean) => void;
  onMediaStateChange: (state: {
    muted: boolean;
    camera: boolean;
    screen: boolean;
    speaking: boolean;
  }) => void;
  onPingChange: (ping: number) => void;
  onLeave: () => void;
  onError: (message: string) => void;
};

function RemoteTrackView({
  media,
  hidden,
  onFocus,
  onPingChange,
}: {
  media: RemoteMedia;
  hidden: boolean;
  onFocus: () => void;
  onPingChange: (ping: number) => void;
}) {
  const element = useRef<HTMLMediaElement>(null);
  const [quality, setQuality] = useState("");
  const [networkStats, setNetworkStats] = useState("");

  useEffect(() => {
    const mediaElement = element.current;
    if (!mediaElement) return;
    media.track.attach(mediaElement);
    const stopStats = monitorTrackVideo(
      media.track,
      setNetworkStats,
      onPingChange,
    );
    return () => {
      stopStats();
      media.track.detach(mediaElement);
    };
  }, [media.track, onPingChange]);

  if (media.track.kind === Track.Kind.Audio) {
    return <audio ref={element as RefObject<HTMLAudioElement>} autoPlay />;
  }

  return (
    <div
      className={`videoCard remote ${hidden ? "videoHidden" : ""}`}
      onClick={onFocus}
    >
      <video
        ref={element as RefObject<HTMLVideoElement>}
        autoPlay
        playsInline
        onLoadedMetadata={(event) =>
          setQuality(videoQuality(event.currentTarget))
        }
        onResize={(event) => setQuality(videoQuality(event.currentTarget))}
      />
      <span>{media.participantName}</span>
      {quality && <small className="qualityBadge">{quality}</small>}
      {networkStats && <small className="networkBadge">{networkStats}</small>}
    </div>
  );
}

export function GroupCall({
  channelId,
  currentUserName,
  microphoneId,
  cameraId,
  microphones,
  cameras,
  autoJoin = false,
  viewOpen,
  onMicrophoneChange,
  onCameraChange,
  onConnectionChange,
  onMediaStateChange,
  onPingChange,
  onLeave,
  onError,
}: GroupCallProps) {
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(true);
  const [participants, setParticipants] = useState<string[]>([]);
  const [remoteMedia, setRemoteMedia] = useState<RemoteMedia[]>([]);
  const [status, setStatus] = useState("Not connected");
  const [focusedVideo, setFocusedVideo] = useState<string | null>(null);
  const [localVideoQuality, setLocalVideoQuality] = useState("");
  const [localVideoStats, setLocalVideoStats] = useState("");
  const roomRef = useRef<Room | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const videoGrid = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(true);
  const stopLocalStats = useRef<(() => void) | null>(null);
  const stopRoomPing = useRef<(() => void) | null>(null);
  const speakingReleaseTimer = useRef<number | null>(null);
  const localSpeaking = useRef(false);
  const onConnectionChangeRef = useRef(onConnectionChange);

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);

  function publishPresence(room: Room, connected: boolean) {
    const names = connected
      ? [
          currentUserName,
          ...[...room.remoteParticipants.values()].map(
            (participant) => participant.name || "Guest",
          ),
        ]
      : [];
    setParticipants(names);
  }

  function clearRoom() {
    if (localVideo.current) localVideo.current.srcObject = null;
    roomRef.current = null;
    setRemoteMedia([]);
    setParticipants([]);
    setJoined(false);
    setJoining(false);
    setMuted(false);
    setCameraOff(true);
    mutedRef.current = false;
    cameraOffRef.current = true;
    stopLocalStats.current?.();
    stopLocalStats.current = null;
    stopRoomPing.current?.();
    stopRoomPing.current = null;
    if (speakingReleaseTimer.current !== null) {
      window.clearTimeout(speakingReleaseTimer.current);
      speakingReleaseTimer.current = null;
    }
    localSpeaking.current = false;
    setLocalVideoStats("");
  }

  async function leave() {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect();
    playVoiceSound("leave");
    clearRoom();
    onConnectionChange(false);
    setStatus("Not connected");
    onLeave();
  }

  useEffect(() => {
    const autoJoinTimer = autoJoin
      ? window.setTimeout(() => joinButton.current?.click(), 0)
      : undefined;
    return () => {
      if (autoJoinTimer !== undefined) window.clearTimeout(autoJoinTimer);
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        stopRoomPing.current?.();
        stopRoomPing.current = null;
        playVoiceSound("leave");
        onConnectionChangeRef.current(false);
        void room.disconnect();
      }
    };
  }, [channelId, autoJoin]);

  async function join() {
    if (joining || joined || roomRef.current) return;
    setJoining(true);
    setStatus("Requesting a group media token...");
    const response = await fetch(`/api/channels/${channelId}/livekit-token`, {
      method: "POST",
    });
    const credentials = (await response.json()) as TokenResponse;
    if (
      !response.ok ||
      !credentials.server_url ||
      !credentials.participant_token
    ) {
      setJoining(false);
      setStatus(credentials.error ?? "Could not join group channel");
      onError(credentials.error ?? "Could not join group channel");
      return;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      publishDefaults: { degradationPreference: "maintain-resolution" },
    });
    roomRef.current = room;
    const updatePresence = () => publishPresence(room, true);
    room
      .on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          setRemoteMedia((current) => [
            ...current.filter((media) => media.id !== publication.trackSid),
            {
              id: publication.trackSid,
              participantName: participant.name || "Guest",
              track,
            },
          ]);
        },
      )
      .on(RoomEvent.TrackUnsubscribed, (_track, publication) => {
        setRemoteMedia((current) =>
          current.filter((media) => media.id !== publication.trackSid),
        );
        setFocusedVideo((current) =>
          current === publication.trackSid ? null : current,
        );
      })
      .on(RoomEvent.ParticipantConnected, () => {
        updatePresence();
        playVoiceSound("join");
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        playVoiceSound("leave");
        setRemoteMedia((current) =>
          current.filter(
            (media) => !participant.trackPublications.has(media.id),
          ),
        );
        updatePresence();
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const speaking = speakers.some(
          (participant) =>
            participant.identity === room.localParticipant.identity,
        );
        if (speakingReleaseTimer.current !== null) {
          window.clearTimeout(speakingReleaseTimer.current);
          speakingReleaseTimer.current = null;
        }
        const publishSpeaking = (next: boolean) => {
          if (localSpeaking.current === next) return;
          localSpeaking.current = next;
          onMediaStateChange({
            muted: mutedRef.current,
            camera: !cameraOffRef.current,
            screen: false,
            speaking: next,
          });
        };
        if (speaking) {
          publishSpeaking(true);
        } else {
          speakingReleaseTimer.current = window.setTimeout(
            () => publishSpeaking(false),
            350,
          );
        }
      })
      .on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        onConnectionChange(false);
        clearRoom();
        setStatus("Disconnected from group channel");
      });

    try {
      setStatus("Connecting to the SFU...");
      await room.connect(credentials.server_url, credentials.participant_token);
      setJoined(true);
      setJoining(false);
      publishPresence(room, true);
      setStatus("Connected through the group media server");
      onConnectionChange(true);
      playVoiceSound("join");
      stopRoomPing.current?.();
      const pingInterval = window.setInterval(() => {
        const ping = Math.round(room.engine.client.rtt);
        if (ping > 0) onPingChange(ping);
      }, 1000);
      stopRoomPing.current = () => window.clearInterval(pingInterval);
      onMediaStateChange({
        muted: false,
        camera: false,
        screen: false,
        speaking: false,
      });

      try {
        await room.localParticipant.setMicrophoneEnabled(
          true,
          voiceCaptureOptions(microphoneId),
        );
      } catch {
        setMuted(true);
        mutedRef.current = true;
        onMediaStateChange({
          muted: true,
          camera: false,
          screen: false,
          speaking: false,
        });
        const message =
          "Microphone is unavailable. You joined the group receive-only.";
        setStatus(message);
        onError(message);
      }
    } catch {
      await room.disconnect();
      clearRoom();
      setStatus("Could not connect to the group media server");
      onError("Could not connect to the group media server");
    }
  }

  async function toggleAudio() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setMicrophoneEnabled(
        muted,
        voiceCaptureOptions(microphoneId),
      );
      setMuted((current) => !current);
      mutedRef.current = !muted;
      onMediaStateChange({
        muted: !muted,
        camera: !cameraOff,
        screen: false,
        speaking: false,
      });
    } catch {
      onError("The microphone could not be changed. Check browser permission.");
    }
  }

  async function toggleVideo() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(cameraOff, {
        ...(cameraId ? { deviceId: cameraId } : {}),
        resolution: { width: 1280, height: 720, frameRate: 30 },
        frameRate: 30,
      });
      if (cameraOff) {
        const cameraTrack = [
          ...room.localParticipant.videoTrackPublications.values(),
        ]
          .map((publication) => publication.track)
          .find(Boolean);
        if (cameraTrack && localVideo.current) {
          cameraTrack.mediaStreamTrack.contentHint = "detail";
          cameraTrack.attach(localVideo.current);
          stopLocalStats.current?.();
          stopLocalStats.current = monitorTrackVideo(
            cameraTrack,
            setLocalVideoStats,
            onPingChange,
          );
        }
      } else if (localVideo.current) {
        stopLocalStats.current?.();
        stopLocalStats.current = null;
        setLocalVideoStats("");
        localVideo.current.srcObject = null;
        setLocalVideoQuality("");
        setFocusedVideo((current) => (current === "local" ? null : current));
      }
      setCameraOff((current) => !current);
      cameraOffRef.current = !cameraOff;
      onMediaStateChange({
        muted,
        camera: cameraOff,
        screen: false,
        speaking: false,
      });
    } catch {
      onError("The camera could not be started. Check browser permission.");
    }
  }

  async function changeMicrophone(deviceId: string) {
    onMicrophoneChange(deviceId);
    const room = roomRef.current;
    if (!room || !deviceId) return;
    try {
      await room.switchActiveDevice("audioinput", deviceId, true);
    } catch {
      onError("The selected microphone could not be opened.");
    }
  }

  async function changeCamera(deviceId: string) {
    onCameraChange(deviceId);
    const room = roomRef.current;
    if (!room || !deviceId || cameraOff) return;
    try {
      await room.switchActiveDevice("videoinput", deviceId, true);
    } catch {
      onError("The selected camera could not be opened.");
    }
  }

  return (
    <section
      className={`callPanel groupCallPanel ${viewOpen ? "" : "backgroundCall"}`}
    >
      <div
        className={`videoGrid groupVideoGrid ${focusedVideo ? "focused" : ""}`}
        ref={videoGrid}
      >
        <div
          className={`videoCard ${cameraOff || (focusedVideo && focusedVideo !== "local") ? "videoHidden" : ""}`}
          onClick={() =>
            setFocusedVideo((current) => (current === "local" ? null : "local"))
          }
        >
          <video
            ref={localVideo}
            autoPlay
            muted
            playsInline
            onLoadedMetadata={(event) =>
              setLocalVideoQuality(videoQuality(event.currentTarget))
            }
            onResize={(event) =>
              setLocalVideoQuality(videoQuality(event.currentTarget))
            }
          />
          <span>You</span>
          {localVideoQuality && (
            <small className="qualityBadge">{localVideoQuality}</small>
          )}
          {localVideoStats && (
            <small className="networkBadge">{localVideoStats}</small>
          )}
        </div>
        {remoteMedia.map((media) => (
          <RemoteTrackView
            media={media}
            hidden={Boolean(focusedVideo && focusedVideo !== media.id)}
            onFocus={() =>
              setFocusedVideo((current) =>
                current === media.id ? null : media.id,
              )
            }
            onPingChange={onPingChange}
            key={media.id}
          />
        ))}
        {focusedVideo && (
          <div className="focusActions">
            <button onClick={() => setFocusedVideo(null)}>Show grid</button>
            <button onClick={() => void videoGrid.current?.requestFullscreen()}>
              Fullscreen
            </button>
          </div>
        )}
      </div>
      <div className="controls voiceDock">
        {!joined ? (
          <button
            ref={joinButton}
            className="primary"
            onClick={() => void join()}
            disabled={joining}
          >
            {joining ? "Joining..." : "Join group channel"}
          </button>
        ) : (
          <>
            <DeviceMenu
              kind="microphone"
              disabled={muted}
              devices={microphones}
              selectedId={microphoneId}
              onAction={() => void toggleAudio()}
              onSelect={(deviceId) => void changeMicrophone(deviceId)}
            />
            <DeviceMenu
              kind="camera"
              disabled={cameraOff}
              devices={cameras}
              selectedId={cameraId}
              onAction={() => void toggleVideo()}
              onSelect={(deviceId) => void changeCamera(deviceId)}
            />
            <button className="danger" onClick={() => void leave()}>
              Leave
            </button>
          </>
        )}
      </div>
      <p className="mediaNotice">
        {status}
        {joined &&
          ` · ${participants.length} participant${participants.length === 1 ? "" : "s"}`}
      </p>
    </section>
  );
}

function voiceCaptureOptions(deviceId: string) {
  return {
    ...(deviceId ? { deviceId } : {}),
    channelCount: 1,
    sampleRate: 48_000,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };
}

function videoQuality(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return "";
  return `${video.videoWidth}×${video.videoHeight} · ${video.videoHeight}p`;
}

function monitorTrackVideo(
  track: {
    getRTCStatsReport: () => Promise<RTCStatsReport | undefined>;
  },
  onChange: (stats: string) => void,
  onPing: (ping: number) => void,
) {
  let previous: { bytes: number; timestamp: number } | null = null;
  const interval = window.setInterval(async () => {
    try {
      const report = await track.getRTCStatsReport();
      if (!report) return;
      let next = "";
      let ping = "";
      report.forEach((raw) => {
        const stat = raw as RTCStats & {
          kind?: string;
          mediaType?: string;
          bytesSent?: number;
          bytesReceived?: number;
          framesPerSecond?: number;
          currentRoundTripTime?: number;
          state?: string;
        };
        if (
          stat.type === "candidate-pair" &&
          stat.state === "succeeded" &&
          stat.currentRoundTripTime !== undefined
        ) {
          const milliseconds = Math.round(stat.currentRoundTripTime * 1000);
          ping = `${milliseconds} ms ping`;
          onPing(milliseconds);
        }
        if (
          !["inbound-rtp", "outbound-rtp"].includes(stat.type) ||
          (stat.kind ?? stat.mediaType) !== "video"
        ) {
          return;
        }
        const bytes = stat.bytesReceived ?? stat.bytesSent;
        if (bytes === undefined) return;
        if (previous) {
          const seconds = (stat.timestamp - previous.timestamp) / 1000;
          if (seconds > 0) {
            const kbps = Math.round(
              ((bytes - previous.bytes) * 8) / seconds / 1000,
            );
            const fps = stat.framesPerSecond
              ? ` · ${Math.round(stat.framesPerSecond)} fps`
              : "";
            next = `${kbps} kbps${fps}`;
          }
        }
        previous = { bytes, timestamp: stat.timestamp };
      });
      onChange([next, ping].filter(Boolean).join(" · "));
    } catch {
      onChange("");
    }
  }, 1000);
  return () => window.clearInterval(interval);
}
