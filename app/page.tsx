"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { playVoiceSound, prepareVoiceSounds } from "./call-sounds";
import { DeviceMenu, MediaDeviceOption, MediaIcon } from "./device-menu";
import { GroupCall } from "./group-call";

type ChatMessage = {
  id: string;
  author: string;
  text: string;
  time: string;
};

type Server = { id: string; name: string };
type ChannelType = "text" | "voice_direct" | "voice_group";
type Channel = { id: string; name: string; type: ChannelType };
type Member = {
  id: string;
  name: string;
  image: string | null;
  role: "owner" | "member";
};
type DemoAccount = {
  id: string;
  name: string;
  expiresAt: string | null;
  status: "pending" | "active" | "expired" | "revoked";
  servers: Server[];
};
type VoiceParticipant = {
  name: string;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  speaking: boolean;
};
type Signal = {
  type: string;
  roomId?: string;
  participants?: Array<string | VoiceParticipant>;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  initiator?: boolean;
  enabled?: boolean;
  muted?: boolean;
  camera?: boolean;
  screen?: boolean;
  speaking?: boolean;
};

const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export default function Home() {
  const { data: session, status: authStatus } = useSession();
  const [servers, setServers] = useState<Server[]>([]);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [form, setForm] = useState<
    "server" | "channel" | "account" | "manage" | "media" | null
  >(null);
  const [formName, setFormName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("text");
  const [inviteServerId, setInviteServerId] = useState("");
  const [chooseInviteServer, setChooseInviteServer] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [revokeCandidateId, setRevokeCandidateId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [mediaNotice, setMediaNotice] = useState("");
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(true);
  const [voicePresence, setVoicePresence] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const [errorMessage, setErrorMessage] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceOption[]>([]);
  const [cameras, setCameras] = useState<MediaDeviceOption[]>([]);
  const [microphoneId, setMicrophoneId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem("lc.microphoneId") ?? ""),
  );
  const [cameraId, setCameraId] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem("lc.cameraId") ?? ""),
  );
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [voiceJoinKey, setVoiceJoinKey] = useState(0);
  const [voiceJoinTarget, setVoiceJoinTarget] = useState("");
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState("");
  const [callViewOpen, setCallViewOpen] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const [focusedDirectVideo, setFocusedDirectVideo] = useState<
    "local" | "remote" | null
  >(null);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [localVideoQuality, setLocalVideoQuality] = useState("");
  const [remoteVideoQuality, setRemoteVideoQuality] = useState("");
  const [directVideoStats, setDirectVideoStats] = useState("");
  const [channelPing, setChannelPing] = useState<Record<string, number>>({});
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const presenceSocket = useRef<WebSocket | null>(null);
  const textSocket = useRef<WebSocket | null>(null);
  const connection = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const accountMenu = useRef<HTMLDivElement>(null);
  const lastTextChannelId = useRef("");
  const activeGroupChannelId = useRef("");
  const directVideoGrid = useRef<HTMLDivElement>(null);
  const directRoomId = useRef("");
  const directReconnectTimer = useRef<number | null>(null);
  const directReconnectAttempt = useRef(0);
  const directReconnectInProgress = useRef(false);
  const stopSpeechMonitor = useRef<(() => void) | null>(null);
  const stopDirectStats = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") location.href = "/login";
    if (authStatus !== "authenticated") return;
    void fetch("/api/servers")
      .then((response) => response.json())
      .then((data: Server[]) => {
        setServers(data);
        setSelectedServerId((current) => current || data[0]?.id || "");
      });
  }, [authStatus]);

  useEffect(() => {
    void loadMediaDevices();

    const handleDeviceChange = () => void loadMediaDevices();
    navigator.mediaDevices?.addEventListener(
      "devicechange",
      handleDeviceChange,
    );
    return () =>
      navigator.mediaDevices?.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
  }, []);

  useEffect(() => {
    if (!selectedServerId) return;
    void fetch(`/api/servers/${selectedServerId}/channels`)
      .then((response) => response.json())
      .then((data: Channel[]) => {
        setChannels(data);
        const firstTextChannel = data.find(
          (channel) => channel.type === "text",
        );
        lastTextChannelId.current = firstTextChannel?.id ?? "";
        setSelectedChannelId(firstTextChannel?.id ?? data[0]?.id ?? "");
      });
  }, [selectedServerId]);

  useEffect(() => {
    if (!selectedServerId) return;
    void fetch(`/api/servers/${selectedServerId}/members`)
      .then((response) => response.json())
      .then((data: Member[]) => setMembers(Array.isArray(data) ? data : []));
  }, [selectedServerId]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeAccountMenu = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeAccountMenu);
    return () => document.removeEventListener("pointerdown", closeAccountMenu);
  }, [accountMenuOpen]);

  useEffect(() => {
    const selected = channels.find(
      (channel) => channel.id === selectedChannelId,
    );
    if (!selectedChannelId || selected?.type !== "text") {
      return;
    }
    void fetch(`/api/channels/${selectedChannelId}/messages`)
      .then((response) => response.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        setMessages(data.map(toChatMessage));
      });
  }, [channels, selectedChannelId]);

  useEffect(() => {
    const selected = channels.find(
      (channel) => channel.id === selectedChannelId,
    );
    if (!selectedChannelId || selected?.type !== "text") return;

    const liveText = createReconnectingSignalingConnection({
      onSocket: (openedSocket) => {
        textSocket.current = openedSocket;
      },
      onOpen: (openedSocket) => {
        openedSocket.send(
          JSON.stringify({
            type: "subscribe-text",
            channelId: selectedChannelId,
          }),
        );
      },
      onMessage: (event) => {
        const incoming = JSON.parse(event.data) as {
          type?: string;
          channelId?: string;
          message?: Parameters<typeof toChatMessage>[0];
        };
        if (
          incoming.type !== "text-message" ||
          incoming.channelId !== selectedChannelId ||
          !incoming.message
        ) {
          return;
        }
        const message = toChatMessage(incoming.message);
        setMessages((current) =>
          current.some((candidate) => candidate.id === message.id)
            ? current
            : [...current, message],
        );
      },
      onError: () => setErrorMessage("Live messaging is reconnecting."),
    });
    return () => {
      liveText.close();
      textSocket.current = null;
    };
  }, [channels, selectedChannelId]);

  useEffect(
    () => () => {
      directRoomId.current = "";
      if (directReconnectTimer.current !== null) {
        window.clearTimeout(directReconnectTimer.current);
        directReconnectTimer.current = null;
      }
      socket.current?.close();
      presenceSocket.current?.close();
      textSocket.current?.close();
      connection.current?.close();
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    const voiceChannelIds = channels
      .filter((channel) => channel.type !== "text")
      .map((channel) => channel.id);
    if (voiceChannelIds.length === 0) return;

    const livePresence = createReconnectingSignalingConnection({
      onSocket: (openedSocket) => {
        presenceSocket.current = openedSocket;
      },
      onOpen: (openedSocket) => {
        openedSocket.send(
          JSON.stringify({
            type: "subscribe-presence",
            roomIds: voiceChannelIds,
          }),
        );
        if (activeGroupChannelId.current) {
          openedSocket.send(
            JSON.stringify({
              type: "set-group-presence",
              roomId: activeGroupChannelId.current,
              present: true,
            }),
          );
        }
      },
      onMessage: (event) => {
        const message = JSON.parse(event.data) as Signal;
        if (
          message.type === "presence" &&
          message.roomId &&
          Array.isArray(message.participants)
        ) {
          setVoicePresence((current) => ({
            ...current,
            [message.roomId!]: message.participants!.map(normalizePresence),
          }));
        }
      },
      onError: () => setErrorMessage("Voice presence is reconnecting."),
    });
    return () => {
      livePresence.close();
      presenceSocket.current = null;
    };
  }, [authStatus, channels]);

  useEffect(() => {
    if (!selectedServerId) return;
    let active = true;
    const loadGroupPresence = async () => {
      try {
        const response = await fetch(
          `/api/servers/${selectedServerId}/voice-presence`,
        );
        if (!response.ok || !active) return;
        const presence = (await response.json()) as Record<
          string,
          Array<string | VoiceParticipant>
        >;
        if (active) {
          setVoicePresence((current) => ({
            ...current,
            ...Object.fromEntries(
              Object.entries(presence).map(([channelId, participants]) => [
                channelId,
                participants.map(normalizePresence),
              ]),
            ),
          }));
        }
      } catch {
        // The next polling cycle retries transient presence failures.
      }
    };
    void loadGroupPresence();
    return () => {
      active = false;
    };
  }, [selectedServerId]);

  function send(signal: Signal | { type: "chat"; text: string }) {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(signal));
    }
  }

  function startDirectSpeechMonitor() {
    stopSpeechMonitor.current?.();
    const audioTrack = stream.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    stopSpeechMonitor.current = monitorSpeaking(audioTrack, (speaking) => {
      send({
        type: "media-state",
        muted: !audioTrack.enabled,
        camera: Boolean(stream.current?.getVideoTracks()[0]?.enabled),
        screen: false,
        speaking,
      });
    });
  }

  async function ensureConnection() {
    if (connection.current) return connection.current;

    const peer = new RTCPeerConnection({ iceServers });
    stream.current?.getTracks().forEach((track) => {
      const sender = peer.addTrack(track, stream.current!);
      if (track.kind === "video") void preferVideoDetail(sender);
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        send({ type: "candidate", candidate: event.candidate.toJSON() });
      }
    };
    peer.ontrack = (event) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
      if (event.track.kind === "video") {
        setRemoteHasVideo(true);
        event.track.addEventListener("ended", () => setRemoteHasVideo(false), {
          once: true,
        });
      }
      setStatus("Connected to guest");
    };
    peer.onconnectionstatechange = () => {
      if (["disconnected", "failed"].includes(peer.connectionState)) {
        setStatus("Guest disconnected");
      }
    };
    connection.current = peer;
    stopDirectStats.current?.();
    stopDirectStats.current = monitorPeerVideo(
      peer,
      setDirectVideoStats,
      (ping) =>
        setChannelPing((current) => ({
          ...current,
          [activeVoiceChannelId]: ping,
        })),
    );
    return peer;
  }

  async function createOffer() {
    const peer = await ensureConnection();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({ type: "offer", sdp: offer });
    setStatus("Calling guest...");
  }

  async function addPendingCandidates(peer: RTCPeerConnection) {
    const candidates = pendingCandidates.current.splice(0);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }

  async function handleSignal(
    message: Signal | { type: "chat"; text: string },
  ) {
    if (message.type === "joined") {
      setJoining(false);
      setJoined(true);
      setStatus("Waiting for another person...");
      if (!directReconnectInProgress.current) playVoiceSound("join");
      directReconnectInProgress.current = false;
      directReconnectAttempt.current = 0;
      send({
        type: "media-state",
        muted,
        camera: !cameraOff,
        screen: false,
        speaking: false,
      });
      return;
    }
    if (message.type === "room-full") {
      setJoining(false);
      setJoined(false);
      setStatus("Room is full");
      setErrorMessage("This direct channel already has two people in it.");
      stopMedia();
      socket.current?.close();
      socket.current = null;
      return;
    }
    if (message.type === "peer-joined") {
      playVoiceSound("join");
      await createOffer();
      send({ type: "camera-state", enabled: !cameraOff });
      return;
    }
    if (message.type === "offer" && "sdp" in message && message.sdp) {
      const peer = await ensureConnection();
      await peer.setRemoteDescription(message.sdp);
      await addPendingCandidates(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({ type: "answer", sdp: answer });
      return;
    }
    if (message.type === "answer" && "sdp" in message && message.sdp) {
      if (!connection.current) return;
      await connection.current.setRemoteDescription(message.sdp);
      await addPendingCandidates(connection.current);
      return;
    }
    if (
      message.type === "candidate" &&
      "candidate" in message &&
      message.candidate
    ) {
      if (connection.current?.remoteDescription) {
        await connection.current.addIceCandidate(message.candidate);
      } else {
        pendingCandidates.current.push(message.candidate);
      }
      return;
    }
    if (message.type === "peer-left") {
      playVoiceSound("leave");
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      connection.current?.close();
      connection.current = null;
      setRemoteHasVideo(false);
      setStatus("Waiting for another person...");
      return;
    }
    if (message.type === "camera-state") {
      setRemoteHasVideo(Boolean(message.enabled));
      if (!message.enabled) {
        setRemoteVideoQuality("");
        setFocusedDirectVideo((current) =>
          current === "remote" ? null : current,
        );
      }
      return;
    }
    // Text messages use PostgreSQL; this socket is only WebRTC signaling.
  }

  async function loadMediaDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setMicrophones(
      devices
        .filter((device) => device.kind === "audioinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        })),
    );
    setCameras(
      devices
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        })),
    );
  }

  async function requestMediaPermissions() {
    setRequestingPermissions(true);
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      await loadMediaDevices();
      setMediaNotice("Microphone and camera access granted.");
    } catch {
      setErrorMessage(
        "Permission was not granted. Allow microphone and camera access in the browser prompt or site settings.",
      );
    } finally {
      setRequestingPermissions(false);
    }
  }

  function selectMicrophone(deviceId: string) {
    setMicrophoneId(deviceId);
    localStorage.setItem("lc.microphoneId", deviceId);
  }

  function selectCamera(deviceId: string) {
    setCameraId(deviceId);
    localStorage.setItem("lc.cameraId", deviceId);
  }

  async function changeActiveMicrophone(deviceId: string) {
    selectMicrophone(deviceId);
    if (!joined || !stream.current) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      const nextTrack = replacement.getAudioTracks()[0];
      const oldTrack = stream.current.getAudioTracks()[0];
      const sender = connection.current
        ?.getSenders()
        .find((candidate) => candidate.track?.kind === "audio");
      if (sender) await sender.replaceTrack(nextTrack);
      if (oldTrack) {
        stream.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.current.addTrack(nextTrack);
      setMuted(false);
      startDirectSpeechMonitor();
      send({
        type: "media-state",
        muted: false,
        camera: !cameraOff,
        screen: false,
        speaking: false,
      });
    } catch {
      setErrorMessage("The selected microphone could not be opened.");
    }
  }

  async function changeActiveCamera(deviceId: string) {
    selectCamera(deviceId);
    const oldTrack = stream.current?.getVideoTracks()[0];
    if (cameraOff || !oldTrack || !stream.current) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(deviceId),
      });
      const nextTrack = replacement.getVideoTracks()[0];
      nextTrack.contentHint = "detail";
      const sender = connection.current
        ?.getSenders()
        .find((candidate) => candidate.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(nextTrack);
        await preferVideoDetail(sender);
      }
      stream.current.removeTrack(oldTrack);
      oldTrack.stop();
      stream.current.addTrack(nextTrack);
      if (localVideo.current) localVideo.current.srcObject = stream.current;
    } catch {
      setErrorMessage("The selected camera could not be opened.");
    }
  }

  function sendGroupPresence(
    channelId: string,
    present: boolean,
    target = presenceSocket.current,
    media = { muted: false, camera: false, screen: false, speaking: false },
  ) {
    if (target?.readyState !== WebSocket.OPEN) return;
    target.send(
      JSON.stringify({
        type: "set-group-presence",
        roomId: channelId,
        participantName: session?.user.name ?? "Guest",
        present,
        ...media,
      }),
    );
  }

  function handleGroupConnection(channelId: string, present: boolean) {
    activeGroupChannelId.current = present ? channelId : "";
    sendGroupPresence(channelId, present);
  }

  function scheduleDirectReconnect(channelId: string) {
    if (
      directRoomId.current !== channelId ||
      directReconnectTimer.current !== null
    ) {
      return;
    }
    const delay = Math.min(
      30_000,
      1000 * 2 ** Math.min(directReconnectAttempt.current, 5),
    );
    directReconnectAttempt.current += 1;
    directReconnectTimer.current = window.setTimeout(
      () => {
        directReconnectTimer.current = null;
        void joinRoom(channelId, true);
      },
      Math.round(delay * (0.8 + Math.random() * 0.4)),
    );
  }

  async function joinRoom(channelId = selectedChannelId, reconnecting = false) {
    if (!channelId || socket.current) return;
    directRoomId.current = channelId;
    directReconnectInProgress.current = reconnecting;
    setJoining(true);
    setStatus(
      reconnecting ? "Reconnecting signaling..." : "Requesting microphone...",
    );
    setMediaNotice("");

    if (!reconnecting) {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        });
        startDirectSpeechMonitor();
        if (localVideo.current) localVideo.current.srcObject = stream.current;
      } catch (error) {
        const permissionDenied =
          error instanceof DOMException && error.name === "NotAllowedError";
        setMediaNotice(
          permissionDenied
            ? "Microphone permission was denied. Joined receive-only."
            : "Microphone is unavailable. Joined receive-only.",
        );
        setErrorMessage(
          permissionDenied
            ? "Microphone permission was denied. You can still listen."
            : "The microphone is unavailable. You can still listen.",
        );
      }
    }

    let ws: WebSocket;
    try {
      ws = await openSignalingSocket();
    } catch {
      setJoining(false);
      setStatus("Signaling disconnected; retrying...");
      setErrorMessage(
        "Could not authenticate the signaling connection. Retrying automatically.",
      );
      scheduleDirectReconnect(channelId);
      return;
    }
    socket.current = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join",
          roomId: channelId,
          participantName: session?.user.name ?? "Guest",
        }),
      );
      setStatus("Joining signaling room...");
    };
    ws.onmessage = (event) => {
      void handleSignal(JSON.parse(event.data)).catch(() => {
        setStatus("WebRTC negotiation failed");
        setErrorMessage("WebRTC negotiation failed. Leave and try again.");
      });
    };
    ws.onerror = () => {
      setJoining(false);
      setStatus("Cannot reach signaling server");
      setErrorMessage(
        "Cannot reach the signaling server. Make sure npm run dev:all is running.",
      );
    };
    ws.onclose = () => {
      if (socket.current === ws) socket.current = null;
      setJoining(false);
      setJoined(false);
      setStatus("Signaling disconnected");
      connection.current?.close();
      connection.current = null;
      pendingCandidates.current = [];
      scheduleDirectReconnect(channelId);
    };
  }

  function stopMedia() {
    stopSpeechMonitor.current?.();
    stopSpeechMonitor.current = null;
    stopDirectStats.current?.();
    stopDirectStats.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
  }

  function leaveRoom() {
    directRoomId.current = "";
    directReconnectInProgress.current = false;
    directReconnectAttempt.current = 0;
    if (directReconnectTimer.current !== null) {
      window.clearTimeout(directReconnectTimer.current);
      directReconnectTimer.current = null;
    }
    const wasConnected = Boolean(socket.current && (joined || joining));
    const activeSocket = socket.current;
    socket.current = null;
    if (activeSocket) {
      activeSocket.onclose = null;
      activeSocket.close();
    }
    connection.current?.close();
    connection.current = null;
    pendingCandidates.current = [];
    stopMedia();
    if (remoteVideo.current) remoteVideo.current.srcObject = null;
    setJoined(false);
    setJoining(false);
    setMuted(false);
    setCameraOff(true);
    setRemoteHasVideo(false);
    setLocalVideoQuality("");
    setRemoteVideoQuality("");
    setDirectVideoStats("");
    setStatus("Not connected");
    setFocusedDirectVideo(null);
    if (wasConnected) playVoiceSound("leave");
  }

  function returnToPreviousTextChannel() {
    leaveRoom();
    setVoiceJoinTarget("");
    setActiveVoiceChannelId("");
    setCallViewOpen(false);
    const fallback = channels.find((channel) => channel.type === "text")?.id;
    setSelectedChannelId(lastTextChannelId.current || fallback || "");
  }

  function toggleAudio() {
    const track = stream.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
      send({
        type: "media-state",
        muted: !track.enabled,
        camera: !cameraOff,
        screen: false,
        speaking: false,
      });
    }
  }

  async function toggleVideo() {
    const track = stream.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCameraOff(!track.enabled);
      send({ type: "camera-state", enabled: track.enabled });
      send({
        type: "media-state",
        muted,
        camera: track.enabled,
        screen: false,
        speaking: false,
      });
      if (!track.enabled) {
        setLocalVideoQuality("");
        setFocusedDirectVideo((current) =>
          current === "local" ? null : current,
        );
      }
      return;
    }

    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: cameraConstraints(cameraId),
      });
      const cameraTrack = cameraStream.getVideoTracks()[0];
      if (!cameraTrack) throw new Error("No camera track");
      cameraTrack.contentHint = "detail";
      if (!stream.current) stream.current = new MediaStream();
      stream.current.addTrack(cameraTrack);
      if (localVideo.current) localVideo.current.srcObject = stream.current;
      const peer = connection.current;
      if (peer) {
        const sender = peer.addTrack(cameraTrack, stream.current);
        await preferVideoDetail(sender);
        await createOffer();
      }
      setCameraOff(false);
      send({ type: "camera-state", enabled: true });
      send({
        type: "media-state",
        muted,
        camera: true,
        screen: false,
        speaking: false,
      });
    } catch {
      setErrorMessage(
        "The camera could not be started. Check browser permission.",
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selectedChannelId) return;
    setDraft("");
    const response = await fetch(
      `/api/channels/${selectedChannelId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    const message = await response.json();
    if (response.ok) {
      const chatMessage = toChatMessage(message);
      setMessages((current) =>
        current.some((candidate) => candidate.id === chatMessage.id)
          ? current
          : [...current, chatMessage],
      );
    }
  }

  async function createServer(event: FormEvent) {
    event.preventDefault();
    const name = formName.trim();
    if (!name) return;
    const response = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const server = await response.json();
    if (response.ok) {
      setServers((current) => [...current, server]);
      setSelectedServerId(server.id);
      closeForm();
    }
  }

  async function createChannel(event: FormEvent) {
    event.preventDefault();
    const name = formName.trim();
    if (!name || !selectedServerId) return;
    const response = await fetch(`/api/servers/${selectedServerId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type: channelType }),
    });
    const channel = await response.json();
    if (response.ok) {
      setChannels((current) => [...current, channel]);
      setSelectedChannelId(channel.id);
      closeForm();
    }
  }

  async function createDemoAccount(event: FormEvent) {
    event.preventDefault();
    if (!inviteServerId) return;
    const name = formName.trim();
    if (!name) return;
    const response = await fetch("/api/demo-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, serverId: inviteServerId }),
    });
    const result = await response.json();
    if (response.ok) {
      setInviteUrl(result.inviteUrl);
      setFormName("");
      if (inviteServerId === selectedServerId && result.member) {
        setMembers((current) => [...current, result.member]);
      }
    }
  }

  function openDemoAccount(serverId: string, chooseServer: boolean) {
    setAccountMenuOpen(false);
    setInviteServerId(serverId);
    setChooseInviteServer(chooseServer);
    setInviteUrl("");
    setForm("account");
  }

  async function openDemoAccountManager() {
    setAccountMenuOpen(false);
    setRevokeCandidateId("");
    setForm("manage");
    const response = await fetch("/api/demo-accounts");
    const data = await response.json();
    setDemoAccounts(response.ok && Array.isArray(data) ? data : []);
  }

  async function revokeDemoAccount(demoUserId: string) {
    const response = await fetch("/api/demo-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demoUserId, action: "revoke" }),
    });
    if (!response.ok) return;
    setDemoAccounts((current) =>
      current.map((account) =>
        account.id === demoUserId
          ? { ...account, status: "revoked", servers: [] }
          : account,
      ),
    );
    setMembers((current) =>
      current.filter((member) => member.id !== demoUserId),
    );
    setRevokeCandidateId("");
  }

  function closeForm() {
    setForm(null);
    setFormName("");
    setInviteUrl("");
    setChooseInviteServer(false);
    setRevokeCandidateId("");
  }

  function selectVoiceChannel(channel: Channel) {
    prepareVoiceSounds();
    leaveRoom();
    setActiveVoiceChannelId(channel.id);
    setCallViewOpen(false);
    setVoiceJoinTarget(channel.id);
    setVoiceJoinKey((current) => current + 1);
    if (channel.type === "voice_direct") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => void joinRoom(channel.id));
      });
    }
  }

  const visibleMembers = members.filter((member) =>
    member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
  );
  const activeVoiceChannel = channels.find(
    (channel) => channel.id === activeVoiceChannelId,
  );
  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId,
  );
  const displayedChannel =
    callViewOpen && activeVoiceChannel ? activeVoiceChannel : selectedChannel;

  if (authStatus !== "authenticated") {
    return <main className="loginPage">Loading LC...</main>;
  }

  return (
    <main className="workspace">
      <aside className="workspaceRail" aria-label="Workspaces">
        <div className="workspaceLogo">LC</div>
        {servers.map((server) => (
          <div className="serverButtonWrap" key={server.id}>
            <button
              className={`workspaceButton ${server.id === selectedServerId ? "active" : ""}`}
              aria-label={server.name}
              onClick={() => {
                leaveRoom();
                setVoiceJoinTarget("");
                setActiveVoiceChannelId("");
                setCallViewOpen(false);
                setSelectedServerId(server.id);
              }}
            >
              {server.name[0]?.toUpperCase()}
            </button>
            <span className="serverTooltip" role="tooltip">
              {server.name}
            </span>
          </div>
        ))}
        {session.user.role === "owner" && (
          <button
            className="workspaceButton"
            aria-label="Create server"
            onClick={() => setForm("server")}
          >
            +
          </button>
        )}
      </aside>
      <aside className="channelSidebar">
        <header className="workspaceName">
          <strong>
            {servers.find((server) => server.id === selectedServerId)?.name ??
              "LC"}
          </strong>
          {session.user.role === "owner" && selectedServerId && (
            <button
              onClick={() => setForm("channel")}
              aria-label="Create channel"
            >
              +
            </button>
          )}
        </header>
        <nav>
          <p className="sectionLabel">TEXT CHANNELS</p>
          {channels
            .filter((channel) => channel.type === "text")
            .map((channel) => (
              <button
                className={`channel ${channel.id === selectedChannelId ? "active" : ""}`}
                key={channel.id}
                onClick={() => {
                  lastTextChannelId.current = channel.id;
                  setCallViewOpen(false);
                  setSelectedChannelId(channel.id);
                }}
              >
                # {channel.name}
              </button>
            ))}
          <p className="sectionLabel">VOICE CHANNELS</p>
          {channels
            .filter((channel) => channel.type !== "text")
            .map((channel) => (
              <div className="voiceChannel" key={channel.id}>
                <button
                  className={`channel ${channel.id === activeVoiceChannelId ? "active" : ""}`}
                  onClick={() => selectVoiceChannel(channel)}
                >
                  {channel.type === "voice_group" ? "◉" : "\u{1F50A}"}{" "}
                  {channel.name}
                  {channel.id === activeVoiceChannelId &&
                    channelPing[channel.id] !== undefined && (
                      <PingIndicator ping={channelPing[channel.id]} />
                    )}
                </button>
                {voicePresence[channel.id]?.some(
                  (participant) => participant.camera || participant.screen,
                ) && (
                  <button
                    className="openCallView"
                    aria-label={`Open video view for ${channel.name}`}
                    onClick={() => {
                      if (activeVoiceChannelId !== channel.id) {
                        selectVoiceChannel(channel);
                        setCallViewOpen(true);
                      } else {
                        setCallViewOpen((current) => !current);
                      }
                    }}
                  >
                    ▣
                  </button>
                )}
                {(voicePresence[channel.id]?.length ?? 0) > 0 && (
                  <div className="voicePresence">
                    {voicePresence[channel.id].map((participant, index) => (
                      <span
                        className={`voiceParticipant ${participant.speaking ? "speaking" : ""}`}
                        key={`${participant.name}-${index}`}
                      >
                        <i>{participant.name[0]?.toUpperCase()}</i>
                        <b>{participant.name}</b>
                        <em className="voiceIndicators">
                          {participant.muted && (
                            <span title="Muted">
                              <MediaIcon kind="microphone" crossedOut />
                            </span>
                          )}
                          {participant.camera && (
                            <span title="Camera on">
                              <MediaIcon kind="camera" crossedOut={false} />
                            </span>
                          )}
                          {participant.screen && (
                            <span title="Sharing screen">
                              <MediaIcon kind="screen" crossedOut={false} />
                            </span>
                          )}
                        </em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </nav>
        <footer className="profileBar">
          <span className="avatar">Y</span>
          <span>
            <strong>{session.user.name ?? "You"}</strong>
            <small>{status}</small>
          </span>
        </footer>
      </aside>
      <section
        className={`room ${selectedChannel?.type === "text" ? "textOnly" : ""}`}
      >
        <header className="roomHeader">
          <strong>
            {displayedChannel
              ? `${displayedChannel.type === "text" ? "#" : displayedChannel.type === "voice_group" ? "◉" : "\u{1F50A}"} ${displayedChannel.name}`
              : "Select a channel"}
          </strong>
          <div
            className={`accountMenu ${accountMenuOpen ? "open" : ""}`}
            ref={accountMenu}
          >
            <button
              className="accountMenuTrigger"
              aria-expanded={accountMenuOpen}
              onClick={() => setAccountMenuOpen((current) => !current)}
            >
              {session.user.name ?? "My account"}
              <span aria-hidden="true">⌄</span>
            </button>
            {accountMenuOpen && (
              <div className="accountMenuDropdown">
                {session.user.role === "owner" && (
                  <>
                    <button
                      onClick={() =>
                        openDemoAccount(
                          selectedServerId || servers[0]?.id || "",
                          true,
                        )
                      }
                    >
                      Create demo account
                    </button>
                    <button onClick={() => void openDemoAccountManager()}>
                      Manage demo accounts
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    setAccountMenuOpen(false);
                    setForm("media");
                    void loadMediaDevices();
                  }}
                >
                  Voice &amp; video settings
                </button>
                <a href="/impressum">Impressum</a>
                <a href="/privacy">Privacy</a>
                <button
                  onClick={() => {
                    setAccountMenuOpen(false);
                    void signOut({ callbackUrl: "/login" });
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>
        {activeVoiceChannel?.type === "voice_direct" && (
          <section
            className={`callPanel ${callViewOpen ? "" : "backgroundCall"}`}
          >
            <div
              className={`videoGrid ${focusedDirectVideo ? "focused" : ""}`}
              ref={directVideoGrid}
            >
              <div
                className={`videoCard ${cameraOff || (focusedDirectVideo && focusedDirectVideo !== "local") ? "videoHidden" : ""}`}
                onClick={() =>
                  setFocusedDirectVideo((current) =>
                    current === "local" ? null : "local",
                  )
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
              </div>
              <div
                className={`videoCard remote ${!remoteHasVideo || (focusedDirectVideo && focusedDirectVideo !== "remote") ? "videoHidden" : ""}`}
                onClick={() =>
                  setFocusedDirectVideo((current) =>
                    current === "remote" ? null : "remote",
                  )
                }
              >
                <video
                  ref={remoteVideo}
                  autoPlay
                  playsInline
                  onLoadedMetadata={(event) =>
                    setRemoteVideoQuality(videoQuality(event.currentTarget))
                  }
                  onResize={(event) =>
                    setRemoteVideoQuality(videoQuality(event.currentTarget))
                  }
                />
                <span>Guest</span>
                {remoteVideoQuality && (
                  <small className="qualityBadge">{remoteVideoQuality}</small>
                )}
                <p>
                  {joined
                    ? "Share this page in another browser to join."
                    : "Join the voice channel to start."}
                </p>
              </div>
              {focusedDirectVideo && (
                <div className="focusActions">
                  <button onClick={() => setFocusedDirectVideo(null)}>
                    Show grid
                  </button>
                  <button
                    onClick={() =>
                      void directVideoGrid.current?.requestFullscreen()
                    }
                  >
                    Fullscreen
                  </button>
                </div>
              )}
              {directVideoStats && (
                <small className="networkBadge">{directVideoStats}</small>
              )}
            </div>
            <div className="controls voiceDock">
              {joined ? (
                <>
                  <DeviceMenu
                    kind="microphone"
                    disabled={muted}
                    devices={microphones}
                    selectedId={microphoneId}
                    onAction={toggleAudio}
                    onSelect={(deviceId) =>
                      void changeActiveMicrophone(deviceId)
                    }
                  />
                  <DeviceMenu
                    kind="camera"
                    disabled={cameraOff}
                    devices={cameras}
                    selectedId={cameraId}
                    onAction={() => void toggleVideo()}
                    onSelect={(deviceId) => void changeActiveCamera(deviceId)}
                  />
                  <button
                    className="danger"
                    onClick={returnToPreviousTextChannel}
                  >
                    Leave
                  </button>
                </>
              ) : (
                <span className="joiningStatus">
                  {joining ? "Joining channel..." : status}
                </span>
              )}
            </div>
            {mediaNotice && <p className="mediaNotice">{mediaNotice}</p>}
          </section>
        )}
        {activeVoiceChannel?.type === "voice_group" && (
          <GroupCall
            key={`${activeVoiceChannel.id}-${voiceJoinKey}`}
            channelId={activeVoiceChannel.id}
            currentUserName={session.user.name ?? "You"}
            microphoneId={microphoneId}
            cameraId={cameraId}
            microphones={microphones}
            cameras={cameras}
            autoJoin={voiceJoinTarget === activeVoiceChannel.id}
            viewOpen={callViewOpen}
            onMicrophoneChange={selectMicrophone}
            onCameraChange={selectCamera}
            onConnectionChange={(present) =>
              handleGroupConnection(activeVoiceChannel.id, present)
            }
            onMediaStateChange={(media) =>
              sendGroupPresence(
                activeVoiceChannel.id,
                true,
                presenceSocket.current,
                media,
              )
            }
            onPingChange={(ping) =>
              setChannelPing((current) => ({
                ...current,
                [activeVoiceChannel.id]: ping,
              }))
            }
            onLeave={returnToPreviousTextChannel}
            onError={setErrorMessage}
          />
        )}
        {selectedChannel?.type === "text" && !callViewOpen && (
          <section className="chat">
            <header>
              <strong>Channel chat</strong>
              <small>Messages are stored in PostgreSQL.</small>
            </header>
            <div className="chatLog">
              {messages.length === 0 && (
                <p className="empty">
                  {selectedChannelId
                    ? "This channel has no messages yet."
                    : "Create or select a channel to begin."}
                </p>
              )}
              {messages.map((message) => (
                <article key={message.id}>
                  <b>{message.author}</b>
                  <time>{message.time}</time>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            <form onSubmit={submit}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!selectedChannelId}
                placeholder={
                  selectedChannel
                    ? `Message #${selectedChannel.name}`
                    : "Select a text channel"
                }
              />
              <button disabled={!selectedChannelId}>Send</button>
            </form>
          </section>
        )}
      </section>
      <aside className="memberSidebar">
        {session.user.role === "owner" && selectedServerId && (
          <button
            className="inviteMemberButton"
            onClick={() => openDemoAccount(selectedServerId, false)}
          >
            + Create demo account
          </button>
        )}
        <p className="sectionLabel">ALL USERS — {members.length}</p>
        <input
          className="memberSearch"
          type="search"
          value={memberSearch}
          onChange={(event) => setMemberSearch(event.target.value)}
          placeholder="Search users"
          aria-label="Search users"
        />
        {visibleMembers.map((member) => (
          <div className="member" key={member.id}>
            <span className={`avatar ${member.role}`}>
              {member.name[0]?.toUpperCase()}
            </span>
            <span>
              <strong>{member.name}</strong>
              <small>{member.role}</small>
            </span>
          </div>
        ))}
      </aside>
      {form && (
        <div className="modalBackdrop" onMouseDown={closeForm}>
          <form
            className="modalCard"
            onSubmit={
              form === "server"
                ? createServer
                : form === "channel"
                  ? createChannel
                  : form === "account"
                    ? createDemoAccount
                    : (event) => event.preventDefault()
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>
              {form === "server"
                ? "Create server"
                : form === "channel"
                  ? "Create channel"
                  : form === "account"
                    ? "Create demo account"
                    : form === "media"
                      ? "Voice & video settings"
                      : "Manage demo accounts"}
            </h2>
            {form !== "manage" && form !== "media" && (
              <label>
                Name
                <input
                  autoFocus
                  value={formName}
                  onChange={(event) => setFormName(event.target.value)}
                  maxLength={60}
                  required
                />
              </label>
            )}
            {form === "channel" && (
              <label>
                Channel type
                <select
                  value={channelType}
                  onChange={(event) =>
                    setChannelType(event.target.value as ChannelType)
                  }
                >
                  <option value="text">Text</option>
                  <option value="voice_direct">
                    Direct voice/video (2 people)
                  </option>
                  <option value="voice_group">
                    Group voice/video (media server)
                  </option>
                </select>
              </label>
            )}
            {form === "account" && chooseInviteServer && (
              <label>
                Server
                <select
                  value={inviteServerId}
                  onChange={(event) => setInviteServerId(event.target.value)}
                  required
                >
                  {servers.map((server) => (
                    <option value={server.id} key={server.id}>
                      {server.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {form === "account" && inviteUrl && (
              <p className="inviteResult">Invitation: {inviteUrl}</p>
            )}
            {form === "manage" && (
              <div className="demoAccountList">
                {demoAccounts.length === 0 && (
                  <p className="empty">No demo accounts yet.</p>
                )}
                {demoAccounts.map((account) => (
                  <article className="demoAccount" key={account.id}>
                    <div>
                      <strong>{account.name}</strong>
                      <span className={`accountStatus ${account.status}`}>
                        {account.status}
                      </span>
                    </div>
                    <small>
                      {account.servers.length
                        ? account.servers
                            .map((server) => server.name)
                            .join(", ")
                        : "No server access"}
                    </small>
                    {account.expiresAt && account.status !== "revoked" && (
                      <small>
                        Expires {new Date(account.expiresAt).toLocaleString()}
                      </small>
                    )}
                    {!["revoked", "expired"].includes(account.status) && (
                      <div className="revokeActions">
                        {revokeCandidateId === account.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setRevokeCandidateId("")}
                            >
                              Cancel
                            </button>
                            <button
                              className="danger"
                              type="button"
                              onClick={() => void revokeDemoAccount(account.id)}
                            >
                              Confirm revoke
                            </button>
                          </>
                        ) : (
                          <button
                            className="danger"
                            type="button"
                            onClick={() => setRevokeCandidateId(account.id)}
                          >
                            Revoke access
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {form === "media" && (
              <div className="mediaSettings">
                <p>
                  Grant access once so LC can show device names and use your
                  saved choices when you join.
                </p>
                <button
                  className="permissionButton"
                  type="button"
                  onClick={() => void requestMediaPermissions()}
                  disabled={requestingPermissions}
                >
                  {requestingPermissions
                    ? "Waiting for browser..."
                    : "Grant microphone & camera access"}
                </button>
                <label>
                  Default microphone
                  <select
                    value={microphoneId}
                    onChange={(event) => selectMicrophone(event.target.value)}
                  >
                    <option value="">System default</option>
                    {microphones.map((device) => (
                      <option value={device.deviceId} key={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Default camera
                  <select
                    value={cameraId}
                    onChange={(event) => selectCamera(event.target.value)}
                  >
                    <option value="">System default</option>
                    {cameras.map((device) => (
                      <option value={device.deviceId} key={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  Camera access is requested here for setup, but your camera
                  remains off when joining a channel.
                </small>
              </div>
            )}
            <div className="modalActions">
              <button type="button" onClick={closeForm}>
                {form === "manage" || form === "media" ? "Close" : "Cancel"}
              </button>
              {form !== "manage" && form !== "media" && (
                <button className="primary" type="submit">
                  {form === "account" && inviteUrl
                    ? "Create another"
                    : "Create"}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
      {errorMessage && (
        <div className="errorToast" role="alert">
          <span>{errorMessage}</span>
          <button
            aria-label="Dismiss error"
            onClick={() => setErrorMessage("")}
          >
            ×
          </button>
        </div>
      )}
    </main>
  );
}

function time() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toChatMessage(message: {
  id: string;
  author: string;
  text: string;
  createdAt?: string | Date;
}): ChatMessage {
  return {
    id: message.id,
    author: message.author,
    text: message.text,
    time: message.createdAt
      ? new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : time(),
  };
}

async function openSignalingSocket() {
  const response = await fetch("/api/signaling-token", { method: "POST" });
  if (!response.ok) throw new Error("Could not create signaling token");
  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error("Signaling token was missing");
  const configuredUrl = process.env.NEXT_PUBLIC_SIGNALING_URL;
  const url = configuredUrl || "ws://localhost:3001";
  const separator = url.includes("?") ? "&" : "?";
  return new WebSocket(`${url}${separator}token=${encodeURIComponent(token)}`);
}

function createReconnectingSignalingConnection({
  onSocket,
  onOpen,
  onMessage,
  onError,
}: {
  onSocket: (socket: WebSocket) => void;
  onOpen: (socket: WebSocket) => void;
  onMessage: (event: MessageEvent) => void;
  onError: () => void;
}) {
  let stopped = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer !== null) return;
    const baseDelay = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    attempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, delay);
  };

  const connect = async () => {
    try {
      const openedSocket = await openSignalingSocket();
      if (stopped) {
        openedSocket.close();
        return;
      }
      socket = openedSocket;
      onSocket(openedSocket);
      openedSocket.onopen = () => {
        attempt = 0;
        onOpen(openedSocket);
      };
      openedSocket.onmessage = onMessage;
      openedSocket.onerror = onError;
      openedSocket.onclose = () => {
        if (socket === openedSocket) socket = null;
        scheduleReconnect();
      };
    } catch {
      onError();
      scheduleReconnect();
    }
  };

  void connect();
  return {
    close() {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}

function cameraConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
  };
}

function videoQuality(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) return "";
  return `${video.videoWidth}×${video.videoHeight} · ${video.videoHeight}p`;
}

async function preferVideoDetail(sender: RTCRtpSender) {
  const parameters = sender.getParameters();
  parameters.degradationPreference = "maintain-resolution";
  try {
    await sender.setParameters(parameters);
  } catch {
    // Some browsers do not allow changing this encoder preference.
  }
}

function monitorSpeaking(
  audioTrack: MediaStreamTrack,
  onChange: (speaking: boolean) => void,
) {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(new MediaStream([audioTrack]));
  const analyser = context.createAnalyser();
  const samples = new Uint8Array(analyser.fftSize);
  let animationFrame = 0;
  let lastSpeaking = false;
  let lastLoudAt = 0;
  source.connect(analyser);

  const sample = () => {
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    const loud = Math.sqrt(sum / samples.length) > 0.035 && audioTrack.enabled;
    if (loud) lastLoudAt = performance.now();
    const speaking = loud || performance.now() - lastLoudAt < 250;
    if (speaking !== lastSpeaking) {
      lastSpeaking = speaking;
      onChange(speaking);
    }
    animationFrame = requestAnimationFrame(sample);
  };
  sample();

  return () => {
    cancelAnimationFrame(animationFrame);
    source.disconnect();
    void context.close();
    if (lastSpeaking) onChange(false);
  };
}

function monitorPeerVideo(
  peer: RTCPeerConnection,
  onChange: (stats: string) => void,
  onPing: (ping: number) => void,
) {
  const previousBytes = new Map<string, { bytes: number; timestamp: number }>();
  const interval = window.setInterval(async () => {
    try {
      const report = await peer.getStats();
      const values: string[] = [];
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
        const previous = previousBytes.get(stat.id);
        previousBytes.set(stat.id, { bytes, timestamp: stat.timestamp });
        if (!previous) return;
        const seconds = (stat.timestamp - previous.timestamp) / 1000;
        if (seconds <= 0) return;
        const kbps = Math.round(
          ((bytes - previous.bytes) * 8) / seconds / 1000,
        );
        const direction = stat.type === "inbound-rtp" ? "down" : "up";
        const fps = stat.framesPerSecond
          ? ` · ${Math.round(stat.framesPerSecond)} fps`
          : "";
        values.push(`${direction} ${kbps} kbps${fps}`);
      });
      onChange([...values, ping].filter(Boolean).join(" · "));
    } catch {
      onChange("");
    }
  }, 1000);
  return () => window.clearInterval(interval);
}

function PingIndicator({ ping }: { ping: number }) {
  const quality = ping < 100 ? "good" : ping <= 200 ? "acceptable" : "bad";
  return (
    <span
      className={`pingIndicator ${quality}`}
      tabIndex={0}
      aria-label={`${ping} millisecond ping, ${quality}`}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="pingDot" />
      <span className="pingTooltip">{ping} ms</span>
    </span>
  );
}

function normalizePresence(
  participant: string | VoiceParticipant,
): VoiceParticipant {
  return typeof participant === "string"
    ? {
        name: participant,
        muted: false,
        camera: false,
        screen: false,
        speaking: false,
      }
    : participant;
}
