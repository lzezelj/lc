"use client";

import { RefObject, useEffect, useRef, useState, type ReactNode } from "react";
import {
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  LocalAudioTrack,
  Room,
  RoomEvent,
  DisconnectReason,
  Track,
  TrackEvent,
} from "livekit-client";
import { DeviceMenu, MediaDeviceOption } from "./device-menu";
import { StreamInfo, fullscreenVideoTile } from "./stream-info";
import { StreamVolume } from "./stream-volume";
import { SoundboardButton, useSoundboard } from "./soundboard";
import {
  applyRemoteAudioVolume,
  participantGain,
  type ParticipantAudio,
} from "./remote-audio-volume";
import { sharedAudioCapture, sharedAudioPublish } from "./shared-audio";
import {
  voiceBlocked,
  type VoicePolicy,
  type VoicePolicies,
} from "./voice-policy";
import { applyVoiceSubscriptions } from "./voice-permissions";
import {
  CameraResolutionSelection,
  cameraResolutions,
  type CameraResolution,
} from "./camera-resolution";
import {
  ScreenShareOptions,
  screenShareResolutions,
  type ScreenShareResolution,
} from "./screen-share-options";
import {
  HideTileButton,
  HiddenTilesMenu,
  SelfViewButton,
} from "./call-tile-controls";
import { playVoiceSound } from "./call-sounds";
import { createAudioWindowStats } from "./audio-window-stats";
import { createVoiceThresholdProcessor } from "./microphone-gate";
import {
  microphoneProcessing,
  monitorVoiceActivity,
  prepareVoiceActivity,
} from "./voice-activity";

type TokenResponse = {
  voicePolicies?: VoicePolicies;
  server_url?: string;
  participant_token?: string;
  error?: string;
};

type RemoteMedia = {
  id: string;
  participantId: string;
  participantName: string;
  track: RemoteTrack;
  isScreen: boolean;
  isSoundboard?: boolean;
};

type GroupCallDiagnostics = {
  recentAudio?: string;
  receivedAudio?: string;
  microphone?: string;
  status: string;
  route: string;
  protocol: string;
  codec: string;
  jitterMs: number | null;
  packetLoss: string;
  concealedAudio: string;
  audioBitrate: string;
};

type GroupCallProps = {
  serverPolicy?: VoicePolicy;
  onVoicePolicies?: (serverId: string, policies: VoicePolicies) => void;
  participantAudio?: Record<string, ParticipantAudio>;
  sessionId?: string;
  serverId?: string;
  serverName?: string;
  cameraResolution?: CameraResolution;
  onCameraResolutionChange?: (resolution: CameraResolution) => void;
  currentUserId?: string;
  focusTarget?: {
    userId: string;
    kind: "camera" | "screen";
    requestId: number;
  } | null;
  channelId: string;
  currentUserName: string;
  microphoneId: string;
  cameraId: string;
  initialMuted?: boolean;
  deafened?: boolean;
  outputVolume?: number;
  outputId?: string;
  audioDeviceOptions?: ReactNode;
  microphones: MediaDeviceOption[];
  cameras: MediaDeviceOption[];
  autoJoin?: boolean;
  viewOpen: boolean;
  onOpenView: () => void;
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
  onDiagnosticsChange: (diagnostics: GroupCallDiagnostics | null) => void;
  onLeave: () => void;
  onReconnect?: () => void;
  onError: (message: string) => void;
};

function RemoteTrackView({
  media,
  hidden,
  onFocus,
  onPingChange,
  onHide,
  volume = 1,
  streamVolume = 100,
  onStreamVolumeChange,
}: {
  media: RemoteMedia;
  hidden: boolean;
  onFocus: () => void;
  onPingChange: (ping: number) => void;
  onHide?: () => void;
  volume?: number;
  streamVolume?: number;
  onStreamVolumeChange?: (volume: number) => void;
}) {
  const element = useRef<HTMLMediaElement>(null);
  const [quality, setQuality] = useState("");
  const [networkStats, setNetworkStats] = useState("");
  const pingCallback = useRef(onPingChange);
  const volumeRef = useRef(volume);
  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    pingCallback.current = onPingChange;
  }, [onPingChange]);

  useEffect(() => {
    const mediaElement = element.current;
    if (!mediaElement) return;
    if (media.track.kind === Track.Kind.Audio)
      applyRemoteAudioVolume(
        media.track as import("livekit-client").RemoteAudioTrack,
        volumeRef.current,
      );
    media.track.attach(mediaElement);
    const stopStats =
      media.track.kind === Track.Kind.Video
        ? monitorTrackVideo(media.track, setNetworkStats, (ping) =>
            pingCallback.current(ping),
          )
        : () => {};
    return () => {
      stopStats();
      media.track.detach(mediaElement);
    };
  }, [media.track]);

  useEffect(() => {
    if (media.track.kind === Track.Kind.Audio)
      applyRemoteAudioVolume(
        media.track as import("livekit-client").RemoteAudioTrack,
        volume,
      );
  }, [media.track, volume]);

  if (media.track.kind === Track.Kind.Audio) {
    return <audio ref={element as RefObject<HTMLAudioElement>} autoPlay />;
  }

  return (
    <div
      className={`videoCard remote ${media.track.isMuted ? "nameOnly" : media.isScreen ? "screenShare" : ""} ${hidden ? "videoHidden" : ""}`}
      onClick={onFocus}
      onDoubleClick={(event) => fullscreenVideoTile(event.currentTarget)}
    >
      <video
        ref={element as RefObject<HTMLVideoElement>}
        autoPlay
        muted
        playsInline
        onLoadedMetadata={(event) =>
          setQuality(videoQuality(event.currentTarget))
        }
        onResize={(event) => setQuality(videoQuality(event.currentTarget))}
      />
      <span>
        {media.participantName}
        {media.isScreen ? " — screen" : ""}
      </span>
      {onHide && (
        <HideTileButton
          label={`${media.participantName}${media.isScreen ? " — screen" : ""}`}
          onHide={onHide}
        />
      )}
      {!media.track.isMuted && (
        <StreamInfo
          quality={quality}
          stats={networkStats}
          name={`${media.participantName}${media.isScreen ? " — screen" : " — camera"}`}
        />
      )}
      {media.isScreen && onStreamVolumeChange && (
        <StreamVolume volume={streamVolume} onChange={onStreamVolumeChange} />
      )}
    </div>
  );
}

export function GroupCall({
  serverPolicy,
  onVoicePolicies,
  participantAudio = {},
  sessionId,
  serverId,
  serverName,
  cameraResolution = "720",
  onCameraResolutionChange,
  currentUserId,
  focusTarget,
  channelId,
  currentUserName,
  microphoneId,
  cameraId,
  initialMuted = false,
  deafened: clientDeafened = false,
  outputVolume = 1,
  outputId = "",
  audioDeviceOptions,
  microphones,
  cameras,
  autoJoin = false,
  viewOpen,
  onOpenView,
  onMicrophoneChange,
  onCameraChange,
  onConnectionChange,
  onMediaStateChange: reportMediaState,
  onPingChange,
  onDiagnosticsChange,
  onLeave,
  onReconnect,
  onError,
}: GroupCallProps) {
  const [roomPolicies, setRoomPolicies] = useState<VoicePolicies>({});
  const ownServerPolicy = serverPolicy ?? roomPolicies[currentUserId ?? ""];
  const deafened = clientDeafened || Boolean(ownServerPolicy?.voiceDeafened);
  const forcedMuted = voiceBlocked(ownServerPolicy);
  const soundboard = useSoundboard(channelId, {
    serverId,
    outputVolume: outputVolume * 100,
    outputId,
    deafened,
    onSpeakingChange: (speaking) => {
      soundSpeaking.current = speaking;
      if (roomRef.current)
        onMediaStateChange({
          muted: mutedRef.current,
          camera: !cameraOffRef.current,
          screen: screenSharing,
          speaking: localSpeaking.current,
        });
    },
  });
  const soundPlayerRef = soundboard.player;
  const [joined, setJoined] = useState(false);
  const [joinAttempted, setJoinAttempted] = useState(false);
  const [joining, setJoining] = useState(false);
  const [userMuted, setMuted] = useState(initialMuted);
  const muted = userMuted || deafened || forcedMuted;
  const [cameraOff, setCameraOff] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShareOptionsOpen, setScreenShareOptionsOpen] = useState(false);
  const [participants, setParticipants] = useState<
    { id: string; name: string }[]
  >([]);
  const [remoteMedia, setRemoteMedia] = useState<RemoteMedia[]>([]);
  const [status, setStatus] = useState("Not connected");
  const [focusedVideo, setFocusedVideo] = useState<string | null>(null);
  const [streamVolumes, setStreamVolumes] = useState<Record<string, number>>(
    {},
  );
  const [hiddenTiles, setHiddenTiles] = useState<string[]>([
    "local",
    "local-screen",
  ]);
  const [localVideoQuality, setLocalVideoQuality] = useState("");
  const [localVideoStats, setLocalVideoStats] = useState("");
  const [localScreenQuality, setLocalScreenQuality] = useState("");
  const [localScreenStats, setLocalScreenStats] = useState("");
  const roomRef = useRef<Room | null>(null);
  const subscriptionPolicy = useRef({
    choices: participantAudio,
    policies: roomPolicies,
    own: ownServerPolicy,
  });
  function refreshSubscriptions(room: Room | null = roomRef.current) {
    if (room)
      applyVoiceSubscriptions(
        room,
        subscriptionPolicy.current.choices,
        subscriptionPolicy.current.policies,
        subscriptionPolicy.current.own,
      );
  }
  useEffect(() => {
    subscriptionPolicy.current = {
      choices: participantAudio,
      policies: roomPolicies,
      own: ownServerPolicy,
    };
    if (roomRef.current)
      applyVoiceSubscriptions(
        roomRef.current,
        participantAudio,
        roomPolicies,
        ownServerPolicy,
      );
  }, [participantAudio, roomPolicies, ownServerPolicy]);
  useEffect(() => {
    const changed = (event: Event) => {
      const data = (
        event as CustomEvent<{
          serverId: string;
          userId: string;
          voiceMuted: boolean;
          voiceDeafened: boolean;
        }>
      ).detail;
      if (data?.serverId === serverId)
        setRoomPolicies((current) => ({
          ...current,
          [data.userId]: {
            voiceMuted: data.voiceMuted,
            voiceDeafened: data.voiceDeafened,
          },
        }));
    };
    window.addEventListener("lc-voice-moderation", changed);
    return () => window.removeEventListener("lc-voice-moderation", changed);
  }, [serverId]);
  const deafenedRef = useRef(deafened);
  const audibleShares = useRef(new Set<string>());
  const focusedRequest = useRef<number | null>(null);
  const joinGeneration = useRef(0);
  const reconnectPending = useRef(false);
  const reconnectTimer = useRef<number | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const localScreen = useRef<HTMLVideoElement>(null);
  const joinButton = useRef<HTMLButtonElement>(null);
  const videoGrid = useRef<HTMLDivElement>(null);
  const mutedRef = useRef(muted);
  const microphoneOperations = useRef<Promise<void>>(Promise.resolve());
  const cameraOffRef = useRef(true);
  const stopLocalStats = useRef<(() => void) | null>(null);
  const stopRoomPing = useRef<(() => void) | null>(null);
  const stopRoomDiagnostics = useRef<(() => void) | null>(null);
  const stopSpeakingMonitor = useRef<(() => void) | null>(null);
  const speakingReleaseTimer = useRef<number | null>(null);
  const localSpeaking = useRef(false);
  const soundSpeaking = useRef(false);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const audioCallbacks = useRef({
    onError,
    onMediaStateChange,
    setMicrophoneEnabled,
    startSpeakingMonitor,
  });
  function onMediaStateChange(
    state: Parameters<GroupCallProps["onMediaStateChange"]>[0],
  ) {
    reportMediaState({
      ...state,
      speaking: state.speaking || soundSpeaking.current,
    });
  }
  useEffect(() => {
    deafenedRef.current = deafened;
    audioCallbacks.current = {
      onError,
      onMediaStateChange,
      setMicrophoneEnabled,
      startSpeakingMonitor,
    };
  });
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    onConnectionChangeRef.current = onConnectionChange;
  }, [onConnectionChange]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !joined) return;
    let cancelled = false;
    if (mutedRef.current) {
      const track = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      )?.track;
      if (track) track.mediaStreamTrack.enabled = false;
    }
    microphoneOperations.current = microphoneOperations.current
      .catch(() => {})
      .then(async () => {
        if (cancelled || roomRef.current !== room) return;
        await audioCallbacks.current.setMicrophoneEnabled(
          room,
          !mutedRef.current,
        );
        if (cancelled || roomRef.current !== room) return;
        audioCallbacks.current.startSpeakingMonitor(room);
        audioCallbacks.current.onMediaStateChange({
          muted: mutedRef.current,
          camera: !cameraOffRef.current,
          screen: Boolean(
            room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
              ?.track,
          ),
          speaking: false,
        });
      })
      .catch(() => {
        if (!cancelled && roomRef.current === room)
          audioCallbacks.current.onError(
            "Could not update the microphone. Check device permissions.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [deafened, joined, forcedMuted]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !joined) return;
    if (
      !outputId &&
      (typeof AudioContext === "undefined" ||
        !("setSinkId" in AudioContext.prototype))
    )
      return;
    let cancelled = false;
    void room
      .switchActiveDevice("audiooutput", outputId || "default")
      .catch(() => {
        if (!cancelled && roomRef.current === room)
          audioCallbacks.current.onError(
            "Could not switch the output device. Select System default or check browser permissions.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [outputId, joined]);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || !joined) return;
    void room
      .switchActiveDevice("audioinput", microphoneId || "default", true)
      .catch(() => {
        if (roomRef.current === room)
          audioCallbacks.current.onError(
            "Could not switch the microphone. Check browser permissions.",
          );
      });
  }, [microphoneId, joined]);

  useEffect(() => {
    if (!focusTarget || focusedRequest.current === focusTarget.requestId)
      return;
    const local = focusTarget.userId === currentUserId;
    const media = remoteMedia.find(
      (item) =>
        item.track.kind === Track.Kind.Video &&
        item.participantId.split(":")[0] === focusTarget.userId &&
        item.isScreen === (focusTarget.kind === "screen"),
    );
    const id = local
      ? focusTarget.kind === "screen"
        ? "local-screen"
        : "local"
      : media?.id;
    if (!id) return;
    focusedRequest.current = focusTarget.requestId;
    const tileId = local
      ? id
      : `${media!.participantId}:${media!.isScreen ? "screen" : "camera"}`;
    void Promise.resolve().then(() => {
      setHiddenTiles((current) =>
        current.filter((hidden) => hidden !== tileId),
      );
      setFocusedVideo(id);
    });
  }, [focusTarget, currentUserId, remoteMedia]);

  useEffect(() => {
    const room = roomRef.current;
    const track = room?.localParticipant.getTrackPublication(
      Track.Source.Camera,
    )?.videoTrack;
    if (!track || cameraOffRef.current) return;
    void track
      .restartTrack({
        ...(cameraId ? { deviceId: cameraId } : {}),
        resolution: cameraResolutions[cameraResolution],
        frameRate: 30,
      })
      .catch(() => {
        if (roomRef.current === room)
          audioCallbacks.current.onError(
            "The selected camera resolution could not be applied.",
          );
      });
  }, [cameraResolution, cameraId]);

  useEffect(() => {
    if (!screenSharing) return;
    const track = roomRef.current?.localParticipant.getTrackPublication(
      Track.Source.ScreenShare,
    )?.track;
    const element = localScreen.current;
    if (!track || !element) return;
    track.attach(element);
    const stopStats = monitorTrackVideo(
      track as import("livekit-client").LocalVideoTrack,
      setLocalScreenStats,
      () => {},
    );
    return () => {
      stopStats();
      track.detach(element);
    };
  }, [screenSharing]);

  function startSpeakingMonitor(room: Room) {
    stopSpeakingMonitor.current?.();
    stopSpeakingMonitor.current = null;
    const track = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
    if (!track) return;
    let stopActivity: (() => void) | undefined;
    const bind = () => {
      stopActivity?.();
      stopActivity = monitorVoiceActivity(
        track.mediaStreamTrack,
        (speaking) => {
          if (roomRef.current !== room) return;
          localSpeaking.current = speaking;
          onMediaStateChange({
            muted: mutedRef.current,
            camera: !cameraOffRef.current,
            screen: Boolean(
              room.localParticipant.getTrackPublication(
                Track.Source.ScreenShare,
              )?.track,
            ),
            speaking,
          });
        },
        () => !mutedRef.current && !track.isMuted,
      );
    };
    bind();
    track.on(TrackEvent.Restarted, bind);
    stopSpeakingMonitor.current = () => {
      track.off(TrackEvent.Restarted, bind);
      stopActivity?.();
    };
  }

  function publishPresence(room: Room, connected: boolean) {
    const names = connected
      ? [
          ...[...room.remoteParticipants.values()].map((participant) => ({
            id: participant.identity,
            name: participant.name || "Guest",
          })),
        ]
      : [];
    setParticipants(names);
  }

  function clearRoom(preserveMute = false) {
    roomRef.current = null;
    soundPlayerRef.current?.stop();
    soundboard.preview.current?.stop();
    soundboard.stopJoinSound();
    if (localVideo.current) localVideo.current.srcObject = null;
    if (localScreen.current) localScreen.current.srcObject = null;
    setRemoteMedia([]);
    setParticipants([]);
    setJoined(false);
    setJoining(false);
    if (!preserveMute) setMuted(false);
    setCameraOff(true);
    setScreenSharing(false);
    if (!preserveMute) mutedRef.current = false;
    cameraOffRef.current = true;
    stopLocalStats.current?.();
    stopLocalStats.current = null;
    stopRoomPing.current?.();
    stopRoomPing.current = null;
    stopRoomDiagnostics.current?.();
    stopRoomDiagnostics.current = null;
    stopSpeakingMonitor.current?.();
    stopSpeakingMonitor.current = null;
    onDiagnosticsChange(null);
    if (speakingReleaseTimer.current !== null) {
      window.clearTimeout(speakingReleaseTimer.current);
      speakingReleaseTimer.current = null;
    }
    localSpeaking.current = false;
    setLocalVideoStats("");
  }

  function releaseRoom(room: Room) {
    for (const publication of room.localParticipant.trackPublications.values()) {
      publication.track?.detach();
      publication.track?.stop();
    }
    void room.disconnect(true);
  }

  function scheduleReconnect() {
    if (!reconnectPending.current || reconnectTimer.current !== null) return;
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      if (!reconnectPending.current) return;
      if (navigator.onLine === false) {
        scheduleReconnect();
        return;
      }
      joinButton.current?.click();
    }, 5000);
  }

  useEffect(() => {
    const autoJoinTimer = autoJoin
      ? window.setTimeout(() => joinButton.current?.click(), 0)
      : undefined;
    const soundPlayer = soundPlayerRef.current;
    const reconnectOnline = () => {
      if (!reconnectPending.current) return;
      if (reconnectTimer.current !== null)
        window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      joinButton.current?.click();
    };
    window.addEventListener("online", reconnectOnline);
    return () => {
      reconnectPending.current = false;
      if (reconnectTimer.current !== null)
        window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      window.removeEventListener("online", reconnectOnline);
      soundPlayer?.stop();
      joinGeneration.current += 1;
      if (autoJoinTimer !== undefined) window.clearTimeout(autoJoinTimer);
      const room = roomRef.current;
      roomRef.current = null;
      if (room) {
        onConnectionChangeRef.current(false);
        stopLocalStats.current?.();
        stopLocalStats.current = null;
        stopRoomPing.current?.();
        stopRoomPing.current = null;
        stopRoomDiagnostics.current?.();
        stopRoomDiagnostics.current = null;
        stopSpeakingMonitor.current?.();
        stopSpeakingMonitor.current = null;
        playVoiceSound("leave");
        releaseRoom(room);
      }
    };
  }, [channelId, autoJoin, soundPlayerRef]);

  async function publishSound(track: MediaStreamTrack) {
    const room = roomRef.current;
    if (!room) throw new Error("Call is not connected");
    const local = new LocalAudioTrack(track);
    await room.localParticipant.publishTrack(local, {
      name: "lc-soundboard",
      source: Track.Source.Unknown,
      ...sharedAudioPublish,
    });
    return () => {
      void room.localParticipant.unpublishTrack(local).catch(() => {});
    };
  }
  async function join() {
    if (joining || joined || roomRef.current) return;
    if (reconnectTimer.current !== null)
      window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = null;
    setJoinAttempted(true);
    const generation = ++joinGeneration.current;
    prepareVoiceActivity();
    setJoining(true);
    setStatus("Requesting a group media token...");
    let response: Response;
    let credentials: TokenResponse;
    try {
      response = await fetch(`/api/channels/${channelId}/livekit-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      credentials = (await response.json()) as TokenResponse;
    } catch {
      if (generation !== joinGeneration.current) return;
      setJoining(false);
      setStatus("Could not request a group media token");
      onError("Could not request a group media token");
      scheduleReconnect();
      return;
    }
    if (generation !== joinGeneration.current) return;
    if (
      !response.ok ||
      !credentials.server_url ||
      !credentials.participant_token
    ) {
      setJoining(false);
      setStatus(credentials.error ?? "Could not join group channel");
      onError(credentials.error ?? "Could not join group channel");
      if ([401, 403, 404].includes(response.status)) {
        reconnectPending.current = false;
        onLeave();
      } else scheduleReconnect();
      return;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: { audioContext: prepareVoiceActivity() },
      ...(outputId ? { audioOutput: { deviceId: outputId } } : {}),
      publishDefaults: { degradationPreference: "maintain-resolution" },
    });
    roomRef.current = room;
    if (credentials.voicePolicies) {
      if (serverId) onVoicePolicies?.(serverId, credentials.voicePolicies);
      setRoomPolicies(credentials.voicePolicies);
      subscriptionPolicy.current = {
        choices: participantAudio,
        policies: credentials.voicePolicies,
        own: credentials.voicePolicies[currentUserId ?? ""],
      };
      mutedRef.current =
        userMuted ||
        clientDeafened ||
        voiceBlocked(credentials.voicePolicies[currentUserId ?? ""]);
    }
    refreshSubscriptions(room);
    const updatePresence = () => {
      if (roomRef.current === room) publishPresence(room, true);
    };
    room
      .on(RoomEvent.LocalTrackPublished, () => {
        refreshSubscriptions(room);
        if (roomRef.current === room) startSpeakingMonitor(room);
      })
      .on(RoomEvent.TrackMuted, () => setRemoteMedia((current) => [...current]))
      .on(RoomEvent.TrackUnmuted, () =>
        setRemoteMedia((current) => [...current]),
      )
      .on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          if (roomRef.current !== room) return;
          if (
            publication.source === Track.Source.ScreenShare &&
            !audibleShares.current.has(participant.identity)
          ) {
            audibleShares.current.add(participant.identity);
            if (!deafenedRef.current) playVoiceSound("share");
          }
          setRemoteMedia((current) => [
            ...current.filter((media) => media.id !== publication.trackSid),
            {
              id: publication.trackSid,
              participantId: participant.identity,
              participantName: participant.name || "Guest",
              track,
              isSoundboard: publication.trackName === "lc-soundboard",
              isScreen:
                publication.source === Track.Source.ScreenShare ||
                publication.source === Track.Source.ScreenShareAudio,
            },
          ]);
        },
      )
      .on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
        if (
          publication.source === Track.Source.ScreenShare &&
          audibleShares.current.delete(participant.identity) &&
          !deafenedRef.current &&
          roomRef.current === room
        )
          playVoiceSound("share-stop");
        setRemoteMedia((current) =>
          current.filter((media) => media.id !== publication.trackSid),
        );
        setFocusedVideo((current) =>
          current === publication.trackSid ? null : current,
        );
      })
      .on(RoomEvent.LocalTrackUnpublished, (publication) => {
        refreshSubscriptions(room);
        if (roomRef.current !== room) return;
        if (publication.source !== Track.Source.ScreenShare) return;
        if (!deafenedRef.current) playVoiceSound("share-stop");
        setScreenSharing(false);
        setFocusedVideo((current) =>
          current === "local-screen" ? null : current,
        );
        onMediaStateChange({
          muted: mutedRef.current,
          camera: !cameraOffRef.current,
          screen: false,
          speaking: localSpeaking.current,
        });
      })
      .on(RoomEvent.ParticipantConnected, (participant) => {
        refreshSubscriptions(room);
        updatePresence();
        soundboard.playJoinSound(participant.identity.split(":")[0]);
      })
      .on(RoomEvent.ParticipantDisconnected, (participant) => {
        refreshSubscriptions(room);
        playVoiceSound("leave");
        setRemoteMedia((current) =>
          current.filter(
            (media) => !participant.trackPublications.has(media.id),
          ),
        );
        updatePresence();
      })
      .on(RoomEvent.Reconnecting, () => {
        if (roomRef.current !== room) return;
        reconnectPending.current = true;
      })
      .on(RoomEvent.Reconnected, () => {
        if (roomRef.current !== room) return;
        refreshSubscriptions(room);
        onReconnect?.();
        reconnectPending.current = false;
        setStatus("Connected through the group media server");
      })
      .on(RoomEvent.Disconnected, (reason) => {
        if (roomRef.current !== room) return;
        onConnectionChange(false);
        clearRoom(true);
        if (
          [
            DisconnectReason.CLIENT_INITIATED,
            DisconnectReason.PARTICIPANT_REMOVED,
            DisconnectReason.DUPLICATE_IDENTITY,
            DisconnectReason.ROOM_DELETED,
          ].includes(reason!)
        ) {
          reconnectPending.current = false;
          setStatus("Disconnected from group channel");
          onLeave();
          return;
        }
        reconnectPending.current = true;
        setStatus("Group voice connection lost; reconnecting...");
        onError(
          "The group voice connection was lost. Check your internet connection; the group voice service (LiveKit) may be unavailable. Reconnecting automatically.",
        );
        scheduleReconnect();
      });

    try {
      setStatus("Connecting to the SFU...");
      await room.connect(credentials.server_url, credentials.participant_token);
      refreshSubscriptions(room);
      if (roomRef.current !== room) {
        releaseRoom(room);
        return;
      }
      setStatus("Preparing microphone...");
      stopRoomPing.current?.();
      const pingInterval = window.setInterval(() => {
        const ping = Math.round(room.engine.client.rtt);
        if (ping > 0) onPingChange(ping);
      }, 1000);
      stopRoomPing.current = () => window.clearInterval(pingInterval);
      stopRoomDiagnostics.current?.();
      stopRoomDiagnostics.current = monitorRoomDiagnostics(
        room,
        onDiagnosticsChange,
        onPingChange,
      );
      try {
        await setMicrophoneEnabled(room, !mutedRef.current);
        if (roomRef.current !== room) {
          releaseRoom(room);
          return;
        }
        startSpeakingMonitor(room);
        setStatus("Connected through the group media server");
      } catch {
        if (roomRef.current !== room) return;
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
      setJoined(true);
      reconnectPending.current = false;
      setJoining(false);
      onConnectionChange(true);
      publishPresence(room, true);
      onMediaStateChange({
        muted: mutedRef.current,
        camera: false,
        screen: false,
        speaking: false,
      });
      soundboard.playJoinSound(currentUserId, publishSound);
    } catch {
      if (roomRef.current !== room) {
        releaseRoom(room);
        return;
      }
      roomRef.current = null;
      onConnectionChange(false);
      releaseRoom(room);
      clearRoom(reconnectPending.current);
      setStatus("Could not connect to the group media server");
      onError(
        "Could not connect to the group voice service (LiveKit). Check your internet connection and try again.",
      );
      scheduleReconnect();
    }
  }

  async function toggleAudio() {
    if (deafened || forcedMuted) return;
    const room = roomRef.current;
    if (!room) return;
    const previousMuted = mutedRef.current;
    const nextMuted = !previousMuted;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    if (nextMuted) {
      const track = room.localParticipant.getTrackPublication(
        Track.Source.Microphone,
      )?.track;
      if (track) track.mediaStreamTrack.enabled = false;
    }
    microphoneOperations.current = microphoneOperations.current
      .catch(() => {})
      .then(async () => {
        if (roomRef.current !== room) return;
        await setMicrophoneEnabled(room, !mutedRef.current);
        if (roomRef.current !== room) return;
        if (nextMuted === mutedRef.current)
          playVoiceSound(nextMuted ? "mute" : "unmute");
        startSpeakingMonitor(room);
        onMediaStateChange({
          muted: mutedRef.current,
          camera: !cameraOffRef.current,
          screen: Boolean(
            room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
              ?.track,
          ),
          speaking: false,
        });
      })
      .catch(() => {
        if (roomRef.current !== room) return;
        if (mutedRef.current === nextMuted) {
          mutedRef.current = previousMuted;
          setMuted(previousMuted);
          const track = room.localParticipant.getTrackPublication(
            Track.Source.Microphone,
          )?.track;
          if (track) track.mediaStreamTrack.enabled = !previousMuted;
        }
        onError(
          "The microphone could not be changed. Check browser permission.",
        );
      });
    await microphoneOperations.current;
  }

  async function toggleVideo() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.setCameraEnabled(cameraOff, {
        ...(cameraId ? { deviceId: cameraId } : {}),
        resolution: cameraResolutions[cameraResolution],
        frameRate: 30,
      });
      if (roomRef.current !== room) {
        releaseRoom(room);
        return;
      }
      if (cameraOff) {
        const cameraTrack = room.localParticipant.getTrackPublication(
          Track.Source.Camera,
        )?.videoTrack;
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
      playVoiceSound(cameraOff ? "camera-on" : "camera-off");
      cameraOffRef.current = !cameraOff;
      onMediaStateChange({
        muted,
        camera: cameraOff,
        screen: screenSharing,
        speaking: false,
      });
    } catch {
      onError("The camera could not be started. Check browser permission.");
    }
  }

  async function toggleScreenShare(resolution?: ScreenShareResolution) {
    const room = roomRef.current;
    if (!room) return;
    if (!screenSharing && !resolution) {
      setScreenShareOptionsOpen(true);
      return;
    }
    setScreenShareOptionsOpen(false);
    try {
      await room.localParticipant.setScreenShareEnabled(
        !screenSharing,
        resolution
          ? {
              resolution: screenShareResolutions[resolution],
              audio: sharedAudioCapture,
              contentHint: "detail",
            }
          : undefined,
        sharedAudioPublish,
      );
      if (roomRef.current !== room) {
        releaseRoom(room);
        return;
      }
      const next = !screenSharing;
      if (next && !deafened) playVoiceSound("share");
      setScreenSharing(next);
      if (next) onOpenView();
      onMediaStateChange({
        muted,
        camera: !cameraOff,
        screen: next,
        speaking: localSpeaking.current,
      });
    } catch {
      onError("The screen could not be shared. Check browser permission.");
    }
  }

  async function changeMicrophone(deviceId: string) {
    onMicrophoneChange(deviceId);
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.switchActiveDevice("audioinput", deviceId || "default", true);
      startSpeakingMonitor(room);
    } catch {
      onError("The selected microphone could not be opened.");
    }
  }

  async function setMicrophoneEnabled(room: Room, enabled: boolean) {
    const publication = room.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    if (publication || !enabled) {
      await room.localParticipant.setMicrophoneEnabled(
        enabled,
        voiceCaptureOptions(microphoneId),
      );
      if (enabled) {
        const track = room.localParticipant.getTrackPublication(
          Track.Source.Microphone,
        )?.track;
        if (track) track.mediaStreamTrack.enabled = !mutedRef.current;
      }
      return;
    }
    const capture = await navigator.mediaDevices.getUserMedia({
      audio: voiceCaptureOptions(microphoneId),
      video: false,
    });
    const track = new LocalAudioTrack(
      capture.getAudioTracks()[0],
      voiceCaptureOptions(microphoneId),
      false,
      prepareVoiceActivity(),
    );
    track.source = Track.Source.Microphone;
    try {
      await track.setProcessor(createVoiceThresholdProcessor());
      if (roomRef.current !== room) {
        track.stop();
        return;
      }
      track.mediaStreamTrack.enabled = !mutedRef.current;
      if (mutedRef.current) await track.mute();
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.Microphone,
      });
      track.mediaStreamTrack.enabled = !mutedRef.current;
      if (mutedRef.current && !track.isMuted) await track.mute();
    } catch (error) {
      track.stop();
      throw error;
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

  const remoteTileId = (media: RemoteMedia) =>
    `${media.participantId}:${media.isScreen ? "screen" : "camera"}`;
  const hideTile = (id: string) => {
    setHiddenTiles((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setFocusedVideo(null);
  };

  const tiles = [
    { id: "local", label: currentUserName },
    ...(screenSharing
      ? [{ id: "local-screen", label: `${currentUserName} — screen` }]
      : []),
    ...participants.map((participant) => ({
      id: `${participant.id}:camera`,
      label: participant.name,
    })),
    ...remoteMedia
      .filter(
        (media) => media.isScreen && media.track.kind === Track.Kind.Video,
      )
      .map((media) => ({
        id: remoteTileId(media),
        label: `${media.participantName} — screen`,
      })),
  ];

  return (
    <section
      className={`callPanel groupCallPanel ${viewOpen ? "" : "backgroundCall"}`}
    >
      <div
        className={`videoGrid groupVideoGrid ${focusedVideo ? "focused" : ""}`}
        ref={videoGrid}
      >
        <div
          className={`videoCard ${cameraOff ? "nameOnly" : ""} ${hiddenTiles.includes("local") || (focusedVideo && focusedVideo !== "local") ? "videoHidden" : ""}`}
          onDoubleClick={(event) => fullscreenVideoTile(event.currentTarget)}
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
          <span>{currentUserName}</span>
          <HideTileButton
            label={currentUserName}
            onHide={() => hideTile("local")}
          />
          {!cameraOff && (
            <StreamInfo
              quality={localVideoQuality}
              stats={localVideoStats}
              name={`${currentUserName} — camera`}
            />
          )}
        </div>
        {screenSharing && (
          <div
            className={`videoCard screenShare ${hiddenTiles.includes("local-screen") || (focusedVideo && focusedVideo !== "local-screen") ? "videoHidden" : ""}`}
            onDoubleClick={(event) => fullscreenVideoTile(event.currentTarget)}
            onClick={() =>
              setFocusedVideo((current) =>
                current === "local-screen" ? null : "local-screen",
              )
            }
          >
            <video
              ref={localScreen}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={(event) =>
                setLocalScreenQuality(videoQuality(event.currentTarget))
              }
              onResize={(event) =>
                setLocalScreenQuality(videoQuality(event.currentTarget))
              }
            />
            <StreamInfo
              quality={localScreenQuality}
              stats={localScreenStats}
              name={`${currentUserName} — screen`}
            />
            <span>{currentUserName} — screen</span>
            <HideTileButton
              label={`${currentUserName} — screen`}
              onHide={() => hideTile("local-screen")}
            />
          </div>
        )}
        {participants
          .filter(
            (participant) =>
              !remoteMedia.some(
                (media) =>
                  media.participantId === participant.id &&
                  media.track.kind === Track.Kind.Video &&
                  !media.isScreen,
              ),
          )
          .map((participant) => (
            <div
              key={participant.id}
              className={`videoCard nameOnly ${focusedVideo || hiddenTiles.includes(`${participant.id}:camera`) ? "videoHidden" : ""}`}
            >
              <span>{participant.name}</span>
              <HideTileButton
                label={participant.name}
                onHide={() => hideTile(`${participant.id}:camera`)}
              />
            </div>
          ))}
        {remoteMedia.map((media) => (
          <RemoteTrackView
            media={media}
            hidden={
              hiddenTiles.includes(remoteTileId(media)) ||
              Boolean(focusedVideo && focusedVideo !== media.id)
            }
            onHide={() => hideTile(remoteTileId(media))}
            onFocus={() =>
              setFocusedVideo((current) =>
                current === media.id ? null : media.id,
              )
            }
            onPingChange={onPingChange}
            volume={
              deafened ||
              (media.isScreen &&
                (!viewOpen ||
                  hiddenTiles.includes(remoteTileId(media)) ||
                  (focusedVideo !== null &&
                    !remoteMedia.some(
                      (item) =>
                        item.participantId === media.participantId &&
                        item.track.kind === Track.Kind.Video &&
                        item.isScreen &&
                        item.id === focusedVideo,
                    ))))
                ? 0
                : outputVolume *
                  participantGain(participantAudio, media.participantId) *
                  (media.isScreen
                    ? (streamVolumes[media.participantId] ?? 100) / 100
                    : media.isSoundboard
                      ? soundboard.muted
                        ? 0
                        : soundboard.volume / 100
                      : 1)
            }
            streamVolume={streamVolumes[media.participantId] ?? 100}
            onStreamVolumeChange={
              media.isScreen
                ? (value) =>
                    setStreamVolumes((current) => ({
                      ...current,
                      [media.participantId]: value,
                    }))
                : undefined
            }
            key={media.id}
          />
        ))}
        <div className="callVisibilityControls">
          <SelfViewButton
            hidden={
              hiddenTiles.includes("local") ||
              hiddenTiles.includes("local-screen")
            }
            onToggle={() => {
              setFocusedVideo(null);
              setHiddenTiles((current) => {
                const others = current.filter(
                  (id) => id !== "local" && id !== "local-screen",
                );
                return current.includes("local") ||
                  current.includes("local-screen")
                  ? others
                  : [...others, "local", "local-screen"];
              });
            }}
          />
          <HiddenTilesMenu
            tiles={tiles}
            hiddenIds={hiddenTiles}
            onRestore={(id) => {
              setFocusedVideo(null);
              setHiddenTiles((current) =>
                current.filter((hidden) => hidden !== id),
              );
            }}
          />
        </div>
        {focusedVideo && (
          <div className="focusActions">
            <button onClick={() => setFocusedVideo(null)}>Show grid</button>
            <button onClick={() => fullscreenVideoTile(videoGrid.current)}>
              Fullscreen
            </button>
          </div>
        )}
      </div>
      <div className="controls voiceDock" aria-busy={!joined || joining}>
        <button
          ref={joinButton}
          hidden={joined || joining || (autoJoin && !joinAttempted)}
          className="primary"
          onClick={() => void join()}
          disabled={joining}
        >
          Join group channel
        </button>
        <DeviceMenu
          kind="microphone"
          actionUnavailable={deafened || forcedMuted}
          extraOptions={audioDeviceOptions}
          unavailable={!joined || joining}
          disabled={muted}
          devices={microphones}
          selectedId={microphoneId}
          onAction={() => void toggleAudio()}
          onSelect={(deviceId) => void changeMicrophone(deviceId)}
        />
        <DeviceMenu
          kind="camera"
          extraOptions={
            onCameraResolutionChange ? (
              <CameraResolutionSelection
                resolution={cameraResolution}
                onChange={onCameraResolutionChange}
              />
            ) : undefined
          }
          unavailable={!joined || joining}
          disabled={cameraOff}
          devices={cameras}
          selectedId={cameraId}
          onAction={() => void toggleVideo()}
          onSelect={(deviceId) => void changeCamera(deviceId)}
        />
        <button
          className={screenSharing ? "stopSharing" : ""}
          disabled={!joined || joining}
          onClick={() => void toggleScreenShare()}
        >
          {screenSharing ? "Stop sharing" : "Share screen"}
        </button>
        <SoundboardButton
          board={soundboard}
          serverId={serverId}
          serverName={serverName}
          disabled={!joined || joining}
          publish={publishSound}
        />
      </div>
      {screenShareOptionsOpen && joined && !joining && (
        <ScreenShareOptions
          onClose={() => setScreenShareOptionsOpen(false)}
          onShare={(resolution) => void toggleScreenShare(resolution)}
        />
      )}
      <p className="mediaNotice">
        {status}
        {joined &&
          ` · ${participants.length + 1} participant${participants.length === 0 ? "" : "s"}`}
      </p>
    </section>
  );
}

function voiceCaptureOptions(deviceId: string) {
  return {
    ...(deviceId ? { deviceId } : {}),
    channelCount: 1,
    sampleRate: 48_000,
    ...microphoneProcessing(),
  };
}

function videoQuality(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return "";
  return `${video.videoWidth}×${video.videoHeight}`;
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
            const fps =
              stat.framesPerSecond !== undefined
                ? ` · ${Math.round(stat.framesPerSecond)} fps`
                : "";
            next = `${stat.type === "inbound-rtp" ? "down" : "up"} ${kbps} kbps${fps}`;
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

function monitorRoomDiagnostics(
  room: Room,
  onChange: (diagnostics: GroupCallDiagnostics) => void,
  onPing: (ping: number) => void,
) {
  const previousBytes = new Map<string, { bytes: number; timestamp: number }>();
  let lastDiagnostics: GroupCallDiagnostics | null = null;
  const audioWindow = createAudioWindowStats();
  const interval = window.setInterval(async () => {
    try {
      const reports: RTCStatsReport[] = [];
      const publisher = await room.engine.pcManager?.publisher.getStats();
      const subscriber = await room.engine.pcManager?.subscriber?.getStats();
      if (publisher) reports.push(publisher);
      if (subscriber) reports.push(subscriber);

      let localCandidate: (RTCStats & Record<string, unknown>) | undefined;
      let remoteCandidate: (RTCStats & Record<string, unknown>) | undefined;
      let codec = "unknown";
      let jitterMs: number | null = null;
      let received = 0;
      let lost = 0;
      let totalSamples = 0;
      let concealedSamples = 0;
      const rates: string[] = [];

      for (const report of reports) {
        let selectedPair: (RTCStats & Record<string, unknown>) | undefined;
        let selectedPairId = "";
        report.forEach((raw) => {
          const stat = raw as RTCStats & Record<string, unknown>;
          if (stat.type === "transport" && stat.selectedCandidatePairId) {
            selectedPairId = String(stat.selectedCandidatePairId);
          }
          if (
            stat.type === "candidate-pair" &&
            stat.state === "succeeded" &&
            (stat.nominated === true || !selectedPair)
          ) {
            selectedPair = stat;
          }
          if (
            ["inbound-rtp", "outbound-rtp"].includes(stat.type) &&
            (stat.kind ?? stat.mediaType) === "audio"
          ) {
            if (stat.type === "inbound-rtp") {
              jitterMs = Math.round(Number(stat.jitter ?? 0) * 1000);
              received += Number(stat.packetsReceived ?? 0);
              lost += Math.max(0, Number(stat.packetsLost ?? 0));
              totalSamples += Number(stat.totalSamplesReceived ?? 0);
              concealedSamples += Number(stat.concealedSamples ?? 0);
            }
            const codecStat = stat.codecId
              ? (report.get(String(stat.codecId)) as
                  (RTCStats & Record<string, unknown>) | undefined)
              : undefined;
            if (codecStat?.mimeType) {
              codec = String(codecStat.mimeType).replace("audio/", "");
            }
            const bytes = Number(stat.bytesReceived ?? stat.bytesSent ?? 0);
            const previous = previousBytes.get(stat.id);
            previousBytes.set(stat.id, { bytes, timestamp: stat.timestamp });
            if (previous) {
              const seconds = (stat.timestamp - previous.timestamp) / 1000;
              if (seconds > 0) {
                rates.push(
                  `${stat.type === "inbound-rtp" ? "down" : "up"} ${Math.round(((bytes - previous.bytes) * 8) / seconds / 1000)} kbps`,
                );
              }
            }
          }
        });
        if (selectedPairId) {
          const transportPair = report.get(selectedPairId) as
            (RTCStats & Record<string, unknown>) | undefined;
          if (transportPair) selectedPair = transportPair;
        }
        if (selectedPair) {
          localCandidate = selectedPair.localCandidateId
            ? (report.get(String(selectedPair.localCandidateId)) as
                (RTCStats & Record<string, unknown>) | undefined)
            : localCandidate;
          remoteCandidate = selectedPair.remoteCandidateId
            ? (report.get(String(selectedPair.remoteCandidateId)) as
                (RTCStats & Record<string, unknown>) | undefined)
            : remoteCandidate;
          if (selectedPair.currentRoundTripTime !== undefined) {
            onPing(
              Math.round(Number(selectedPair.currentRoundTripTime) * 1000),
            );
          }
        }
      }

      const packetTotal = received + lost;
      const nextDiagnostics: GroupCallDiagnostics = {
        receivedAudio: `${received} packets`,
        recentAudio: audioWindow({
          received,
          lost,
          concealed: concealedSamples,
          samples: totalSamples,
        }),
        microphone: (() => {
          const track = room.localParticipant.getTrackPublication(
            Track.Source.Microphone,
          )?.track?.mediaStreamTrack;
          return track
            ? `${track.readyState}${track.muted ? " / capture interrupted" : ""}${!track.enabled ? " / muted" : ""} / ${track.getSettings().sampleRate ?? "?"} Hz`
            : "unavailable";
        })(),
        status: room.state,
        route: localCandidate
          ? `${String(localCandidate.candidateType ?? "unknown")} → ${String(remoteCandidate?.candidateType ?? "unknown")}`
          : (lastDiagnostics?.route ?? "unknown → unknown"),
        protocol: localCandidate?.protocol
          ? String(localCandidate.protocol).toUpperCase()
          : (lastDiagnostics?.protocol ?? "unknown"),
        codec: codec !== "unknown" ? codec : (lastDiagnostics?.codec ?? codec),
        jitterMs,
        packetLoss: packetTotal
          ? `${((lost / packetTotal) * 100).toFixed(1)}%`
          : "0%",
        concealedAudio: totalSamples
          ? `${((concealedSamples / totalSamples) * 100).toFixed(1)}%`
          : "0%",
        audioBitrate:
          rates.join(" / ") || lastDiagnostics?.audioBitrate || "measuring…",
      };
      lastDiagnostics = nextDiagnostics;
      onChange(nextDiagnostics);
    } catch {
      if (lastDiagnostics) {
        onChange({ ...lastDiagnostics, status: "connected (stats delayed)" });
      } else {
        onChange({
          status: "statistics unavailable",
          route: "unknown → unknown",
          protocol: "unknown",
          codec: "unknown",
          jitterMs: null,
          packetLoss: "unknown",
          concealedAudio: "unknown",
          audioBitrate: "unknown",
        });
      }
    }
  }, 1000);
  return () => window.clearInterval(interval);
}
