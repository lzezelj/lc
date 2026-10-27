"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { playVoiceSound, prepareVoiceSounds } from "./call-sounds";
import { DeviceMenu, MediaDeviceOption, MediaIcon } from "./device-menu";
import { GroupCall } from "./group-call";
import { useCallAudio } from "./call-media";
import { formatUserHandle } from "../user-handle";
import { createSignalQueue } from "./direct-negotiation";
import { createAudioWindowStats } from "./audio-window-stats";
import {
  microphoneProcessing,
  monitorVoiceActivity,
  prepareVoiceActivity,
} from "./voice-activity";

type ChatMessage = {
  id: string;
  authorId: string;
  author: string;
  text: string;
  time: string;
  deleted: boolean;
  replyTo: { id: string; text: string; author: string } | null;
  kind: "message" | "call";
  callDurationSeconds: number | null;
};

type Server = { id: string; name: string };
type Friend = {
  id: string;
  name: string;
  handle: string;
  image: string | null;
  status: "pending" | "accepted";
  incoming: boolean;
  lastActivityAt: string | null;
  lastMessage: {
    text: string;
    kind: "message" | "call";
    createdAt: string;
  } | null;
};
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
type AccountMessage = {
  id: string;
  text: string;
  createdAt: string;
  channelName: string;
  serverName: string;
};
type VoiceParticipant = {
  userId?: string;
  name: string;
  muted: boolean;
  camera: boolean;
  screen: boolean;
  speaking: boolean;
};
type CallDiagnostics = {
  connectivity?: string;
  negotiation?: string;
  playback?: string;
  receivedAudio?: string;
  recentAudio?: string;
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
type Signal = {
  type: string;
  serverId?: string;
  userIds?: string[];
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
  fromUserId?: string;
  fromName?: string;
  targetUserId?: string;
  messageId?: string;
  permanent?: boolean;
  message?: Parameters<typeof toChatMessage>[0];
};

const fallbackIceServers: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
let cachedIceServers: { servers: RTCIceServer[]; expiresAt: number } | null =
  null;

async function loadIceServers() {
  if (cachedIceServers && cachedIceServers.expiresAt > Date.now() + 60_000) {
    return cachedIceServers.servers;
  }
  try {
    const response = await fetch("/api/ice-servers", {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return fallbackIceServers;
    const data = (await response.json()) as {
      iceServers?: RTCIceServer[];
      expiresAt?: number | null;
    };
    if (!data.iceServers?.length) return fallbackIceServers;
    cachedIceServers = {
      servers: data.iceServers,
      expiresAt: data.expiresAt ? data.expiresAt * 1000 : Date.now() + 300_000,
    };
    return data.iceServers;
  } catch {
    return fallbackIceServers;
  }
}

function formatLocalDateTime(value: string) {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCallDuration(seconds: number | null) {
  const total = Math.max(0, seconds ?? 0);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function Home() {
  const remoteAudio = useCallAudio();
  const { data: session, status: authStatus } = useSession();
  const [servers, setServers] = useState<Server[]>([]);
  const [friendsView, setFriendsView] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendResults, setFriendResults] = useState<Friend[]>([]);
  const [friendTab, setFriendTab] = useState<"online" | "offline" | "pending">(
    "online",
  );
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [directMessages, setDirectMessages] = useState<ChatMessage[]>([]);
  const [unreadDirectMessages, setUnreadDirectMessages] = useState<
    Record<string, number>
  >({});
  const [incomingCall, setIncomingCall] = useState<{
    fromUserId: string;
    fromName: string;
    roomId: string;
  } | null>(null);
  const [callPeerPresent, setCallPeerPresent] = useState(false);
  const [signalingRefreshKey, setSignalingRefreshKey] = useState(0);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [form, setForm] = useState<
    "server" | "channel" | "account" | "manage" | "media" | "messages" | null
  >(null);
  const [formName, setFormName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("text");
  const [inviteServerId, setInviteServerId] = useState("");
  const [chooseInviteServer, setChooseInviteServer] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [demoMenuOpen, setDemoMenuOpen] = useState(false);
  const [serverListToggled, setServerListToggled] = useState(false);
  const [channelsHidden, setChannelsHidden] = useState(false);
  const [userListToggled, setUserListToggled] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [addFriendsOpen, setAddFriendsOpen] = useState(false);
  const [deleteServerOpen, setDeleteServerOpen] = useState(false);
  const [serverFriendSearch, setServerFriendSearch] = useState("");
  const [selectedServerFriendIds, setSelectedServerFriendIds] = useState<
    string[]
  >([]);
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  const [editingDemoServers, setEditingDemoServers] = useState<string[]>([]);
  const [editingDemoAccount, setEditingDemoAccount] =
    useState<DemoAccount | null>(null);
  const [extendingDemoAccount, setExtendingDemoAccount] =
    useState<DemoAccount | null>(null);
  const [demoExtensionHours, setDemoExtensionHours] = useState("4");
  const [extendingDemoAccess, setExtendingDemoAccess] = useState(false);
  const [demoInviteLinks, setDemoInviteLinks] = useState<
    Record<string, string>
  >({});
  const [deleteDemoCandidate, setDeleteDemoCandidate] =
    useState<DemoAccount | null>(null);
  const [deleteDemoMessages, setDeleteDemoMessages] = useState(false);
  const [regenerateInviteCandidate, setRegenerateInviteCandidate] =
    useState<DemoAccount | null>(null);
  const [revokeCandidateId, setRevokeCandidateId] = useState("");
  const [messageAccount, setMessageAccount] = useState({ id: "", name: "" });
  const [accountMessages, setAccountMessages] = useState<AccountMessage[]>([]);
  const [deleteMessagesPending, setDeleteMessagesPending] = useState(false);
  const [returnToDemoManager, setReturnToDemoManager] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextMessageCursor, setNextMessageCursor] = useState<{
    beforeCreatedAt: string;
    beforeId: string;
  } | null>(null);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{
    message: ChatMessage;
    x: number;
    y: number;
  } | null>(null);
  const [deleteMessageCandidate, setDeleteMessageCandidate] = useState<{
    id: string;
    preview: string;
    conversationUserId?: string;
  } | null>(null);
  const [permanentMessageDeletion, setPermanentMessageDeletion] =
    useState(false);
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
  const [noticeMessage, setNoticeMessage] = useState("");
  const [legalDocument, setLegalDocument] = useState<
    "impressum" | "privacy" | null
  >(null);
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
  const [connectedGroupChannelId, setConnectedGroupChannelId] = useState("");
  const [activeVoiceChannelSnapshot, setActiveVoiceChannelSnapshot] =
    useState<Channel | null>(null);
  const [callViewOpen, setCallViewOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{
    kind: "user" | "demo" | "server" | "channel";
    id: string;
    name: string;
  } | null>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberMenu, setMemberMenu] = useState<{
    member: Member;
    x: number;
    y: number;
  } | null>(null);
  const [kickCandidate, setKickCandidate] = useState<Member | null>(null);
  const [focusedDirectVideo, setFocusedDirectVideo] = useState<
    "local" | "remote" | null
  >(null);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const [localVideoQuality, setLocalVideoQuality] = useState("");
  const [remoteVideoQuality, setRemoteVideoQuality] = useState("");
  const [directVideoStats, setDirectVideoStats] = useState("");
  const [callDiagnostics, setCallDiagnostics] =
    useState<CallDiagnostics | null>(null);
  const [directPing, setDirectPing] = useState<number | null>(null);
  const [directLocalSpeaking, setDirectLocalSpeaking] = useState(false);
  const [directRemoteSpeaking, setDirectRemoteSpeaking] = useState(false);
  const [channelPing, setChannelPing] = useState<Record<string, number>>({});
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const remoteVisualStream = useRef<MediaStream | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const presenceSocket = useRef<WebSocket | null>(null);
  const textSocket = useRef<WebSocket | null>(null);
  const connection = useRef<RTCPeerConnection | null>(null);
  const creatingConnection = useRef<Promise<RTCPeerConnection> | null>(null);
  const peerGeneration = useRef(0);
  const [audioPlaybackBlocked, setAudioPlaybackBlocked] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const accountMenu = useRef<HTMLDivElement>(null);
  const demoMenu = useRef<HTMLDivElement>(null);
  const serverSettingsMenu = useRef<HTMLDivElement>(null);
  const messageContextMenu = useRef<HTMLDivElement>(null);
  const memberContextMenu = useRef<HTMLDivElement>(null);
  const lastTextChannelId = useRef("");
  const activeGroupChannelId = useRef("");
  const directVideoGrid = useRef<HTMLDivElement>(null);
  const directRoomId = useRef("");
  const friendCallStartedAt = useRef(0);
  const friendCallPartnerId = useRef("");
  const leaveRoomRef = useRef<() => void>(() => undefined);
  const selectedFriendId = useRef("");
  const friendsViewRef = useRef(false);
  const selectedServerIdRef = useRef("");
  const voiceChannelIdsRef = useRef<string[]>([]);
  const directReconnectTimer = useRef<number | null>(null);
  const directReconnectAttempt = useRef(0);
  const directReconnectInProgress = useRef(false);
  const accessRefreshInProgress = useRef(false);
  const refreshAccessRef = useRef<() => void>(() => undefined);
  const unavailableCallRef = useRef<() => void>(() => undefined);
  const recordCallOutcomeRef = useRef<
    (event: "call-ended" | "call-declined" | "user-unavailable") => void
  >(() => undefined);
  const closeCallViewRef = useRef<() => void>(() => undefined);
  const serverSwitchRequest = useRef(0);
  const stopSpeechMonitor = useRef<(() => void) | null>(null);
  const stopRemoteSpeechMonitor = useRef<(() => void) | null>(null);
  const stopDirectStats = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (localVideo.current) localVideo.current.srcObject = stream.current;
    if (remoteVideo.current)
      remoteVideo.current.srcObject = remoteVisualStream.current;
    const audio = remoteAudio.current;
    if (audio?.srcObject && audio.paused) {
      void audio
        .play()
        .then(() => setAudioPlaybackBlocked(false))
        .catch(() => setAudioPlaybackBlocked(true));
    }
  }, [friendsView, activeVoiceChannelId, serversLoaded, remoteAudio]);

  useEffect(() => {
    if (authStatus === "unauthenticated") location.href = "/login";
    if (authStatus !== "authenticated") return;
    void fetch("/api/servers")
      .then((response) => response.json())
      .then((data: Server[]) => {
        setServers(data);
        setSelectedServerId((current) => current || data[0]?.id || "");
      })
      .finally(() => setServersLoaded(true));
  }, [authStatus]);

  async function loadFriends() {
    const response = await fetch("/api/friends");
    if (response.ok) setFriends(await response.json());
  }

  useEffect(() => {
    selectedFriendId.current = selectedFriend?.id ?? "";
    friendsViewRef.current = friendsView;
  }, [friendsView, selectedFriend?.id]);

  useEffect(() => {
    selectedServerIdRef.current = selectedServerId;
    voiceChannelIdsRef.current = channels
      .filter((channel) => channel.type !== "text")
      .map((channel) => channel.id);
    const activeSocket = presenceSocket.current;
    if (activeSocket?.readyState !== WebSocket.OPEN) return;
    if (selectedServerId) {
      activeSocket.send(
        JSON.stringify({
          type: "subscribe-online",
          serverId: selectedServerId,
        }),
      );
    }
    activeSocket.send(
      JSON.stringify({
        type: "subscribe-presence",
        roomIds: voiceChannelIdsRef.current,
      }),
    );
  }, [channels, selectedServerId]);

  useEffect(() => {
    if (authStatus === "authenticated") {
      const timeout = window.setTimeout(() => void loadFriends(), 0);
      return () => window.clearTimeout(timeout);
    }
  }, [authStatus]);

  const incomingFriendRequestCount = friends.filter(
    (friend) => friend.status === "pending" && friend.incoming,
  ).length;
  const unreadMessageCount = Object.values(unreadDirectMessages).reduce(
    (total, count) => total + count,
    0,
  );
  const notificationCount = incomingFriendRequestCount + unreadMessageCount;

  useEffect(() => {
    document.title = unreadMessageCount ? `(${unreadMessageCount}) LC` : "LC";
    return () => {
      document.title = "LC";
    };
  }, [unreadMessageCount]);

  useEffect(() => {
    if (!noticeMessage) return;
    const timeout = window.setTimeout(() => setNoticeMessage(""), 10_000);
    return () => window.clearTimeout(timeout);
  }, [noticeMessage]);

  useEffect(() => {
    const enableCallAudio = () => prepareVoiceSounds();
    document.addEventListener("pointerdown", enableCallAudio, { once: true });
    return () => document.removeEventListener("pointerdown", enableCallAudio);
  }, []);

  useEffect(() => {
    if (!incomingCall) return;
    prepareVoiceSounds();
    playVoiceSound("ring");
    const interval = window.setInterval(() => playVoiceSound("ring"), 1600);
    const timeout = window.setTimeout(() => setIncomingCall(null), 20_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [incomingCall]);

  useEffect(() => {
    if (!activeVoiceChannelId.startsWith("friend:") || callPeerPresent) return;
    const timeout = window.setTimeout(
      () => unavailableCallRef.current(),
      20_000,
    );
    return () => window.clearTimeout(timeout);
  }, [activeVoiceChannelId, callPeerPresent]);

  useEffect(() => {
    if (friendsView) setTimeout(() => void loadFriends(), 0);
  }, [friendsView]);

  useEffect(() => {
    if (!selectedFriend) return;
    void fetch(`/api/direct-messages/${selectedFriend.id}`)
      .then((response) => response.json())
      .then((data) =>
        setDirectMessages(Array.isArray(data) ? data.map(toChatMessage) : []),
      );
  }, [selectedFriend]);

  function openFriend(friend: Friend) {
    setSelectedFriend(friend);
    setUnreadDirectMessages((current) => {
      const next = { ...current };
      delete next[friend.id];
      return next;
    });
  }

  async function searchFriends(query = friendSearch) {
    const response = await fetch(
      `/api/friends/search?q=${encodeURIComponent(query)}`,
    );
    if (response.ok) setFriendResults(await response.json());
  }

  async function friendAction(
    action: "request" | "accept" | "decline",
    friend: Friend,
  ) {
    const response = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "request"
          ? { action, handle: friend.handle }
          : { action, userId: friend.id },
      ),
    });
    if (!response.ok)
      setErrorMessage((await response.json()).error ?? "Friend action failed.");
    else {
      setFriendResults([]);
      setFriendSearch("");
      await loadFriends();
      invalidateSignalingToken();
      setSignalingRefreshKey((current) => current + 1);
    }
  }

  async function sendDirectMessage(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!selectedFriend || !text) return;
    const response = await fetch(`/api/direct-messages/${selectedFriend.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const message = await response.json();
    if (!response.ok)
      return setErrorMessage(message.error ?? "Message could not be sent.");
    setDirectMessages((current) => [...current, toChatMessage(message)]);
    await loadFriends();
    setDraft("");
  }

  async function startFriendCall(friend: Friend) {
    const response = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "activity", userId: friend.id }),
    });
    if (response.ok) await loadFriends();
    if (presenceSocket.current?.readyState === WebSocket.OPEN) {
      presenceSocket.current.send(
        JSON.stringify({ type: "call-invite", targetUserId: friend.id }),
      );
    }
    friendCallPartnerId.current = friend.id;
    selectVoiceChannel({
      id: `friend:${[session!.user.id, friend.id].sort().join(":")}`,
      name: friend.name,
      type: "voice_direct",
    });
  }

  async function recordCallOutcome(
    event: "call-ended" | "call-declined" | "user-unavailable",
  ) {
    const partnerId = friendCallPartnerId.current;
    if (!partnerId || !friendCallStartedAt.current) return;
    const durationSeconds = Math.max(
      0,
      Math.round((Date.now() - friendCallStartedAt.current) / 1000),
    );
    friendCallStartedAt.current = 0;
    friendCallPartnerId.current = "";
    const response = await fetch(`/api/direct-messages/${partnerId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, durationSeconds }),
    });
    if (!response.ok) return;
    const message = toChatMessage(await response.json());
    setDirectMessages((current) =>
      current.some((candidate) => candidate.id === message.id)
        ? current
        : [...current, message],
    );
    await loadFriends();
  }
  recordCallOutcomeRef.current = (event) => void recordCallOutcome(event);

  function endFriendCall() {
    send({ type: "hangup" });
    void recordCallOutcome("call-ended");
    returnToPreviousTextChannel();
  }

  function markUserUnavailable() {
    const partnerId = friendCallPartnerId.current;
    if (partnerId && presenceSocket.current?.readyState === WebSocket.OPEN) {
      presenceSocket.current.send(
        JSON.stringify({ type: "call-cancel", targetUserId: partnerId }),
      );
    }
    void recordCallOutcome("user-unavailable");
    returnToPreviousTextChannel();
  }
  unavailableCallRef.current = markUserUnavailable;

  function answerIncomingCall() {
    if (!incomingCall) return;
    const caller = friends.find(
      (friend) => friend.id === incomingCall.fromUserId,
    );
    setIncomingCall(null);
    setFriendsView(true);
    if (caller) openFriend(caller);
    friendCallPartnerId.current = incomingCall.fromUserId;
    selectVoiceChannel({
      id: incomingCall.roomId,
      name: incomingCall.fromName,
      type: "voice_direct",
    });
  }

  function declineIncomingCall() {
    if (!incomingCall) return;
    if (presenceSocket.current?.readyState === WebSocket.OPEN) {
      presenceSocket.current.send(
        JSON.stringify({
          type: "call-decline",
          targetUserId: incomingCall.fromUserId,
        }),
      );
    }
    setIncomingCall(null);
  }

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
    let active = true;
    void Promise.all([
      fetch(`/api/servers/${selectedServerId}/channels`).then((response) =>
        response.json(),
      ),
      fetch(`/api/servers/${selectedServerId}/members`).then((response) =>
        response.json(),
      ),
    ])
      .then(([channelData, memberData]: [Channel[], Member[]]) => {
        if (!active) return;
        setChannels(Array.isArray(channelData) ? channelData : []);
        setMembers(Array.isArray(memberData) ? memberData : []);
        const firstTextChannel = channelData.find(
          (channel) => channel.type === "text",
        );
        lastTextChannelId.current = firstTextChannel?.id ?? "";
        setSelectedChannelId(firstTextChannel?.id ?? channelData[0]?.id ?? "");
        if (session?.user.id) {
          setOnlineUserIds((current) => [
            ...new Set([...current, session.user.id]),
          ]);
        }
      })
      .catch(() => setErrorMessage("The server could not be loaded."))
      .finally(() => undefined);
    return () => {
      active = false;
    };
  }, [selectedServerId, session?.user.id]);

  async function switchServer(serverId: string) {
    if (!serverId || serverId === selectedServerId) return;
    const requestId = ++serverSwitchRequest.current;
    try {
      const [channelData, memberData] = await Promise.all([
        fetch(`/api/servers/${serverId}/channels`).then(
          (response) => response.json() as Promise<Channel[]>,
        ),
        fetch(`/api/servers/${serverId}/members`).then(
          (response) => response.json() as Promise<Member[]>,
        ),
      ]);
      if (requestId !== serverSwitchRequest.current) return;
      const nextChannels = Array.isArray(channelData) ? channelData : [];
      setChannels(nextChannels);
      setMembers(Array.isArray(memberData) ? memberData : []);
      const firstTextChannel = nextChannels.find(
        (channel) => channel.type === "text",
      );
      lastTextChannelId.current = firstTextChannel?.id ?? "";
      setSelectedChannelId(firstTextChannel?.id ?? nextChannels[0]?.id ?? "");
      setCallViewOpen(false);
      setSelectedServerId(serverId);
    } catch {
      setErrorMessage("The server could not be loaded.");
    }
  }

  async function refreshAccess() {
    if (accessRefreshInProgress.current) return;
    accessRefreshInProgress.current = true;
    try {
      const response = await fetch("/api/servers", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) {
        location.href = "/login";
        return;
      }
      if (!response.ok) throw new Error("Access refresh failed");
      const nextServers = (await response.json()) as Server[];
      setServers(nextServers);
      setSelectedServerId((current) =>
        nextServers.some((server) => server.id === current)
          ? current
          : (nextServers[0]?.id ?? ""),
      );
      await loadFriends();
    } catch {
      setErrorMessage(
        "Access changed, but the workspace could not be refreshed.",
      );
    } finally {
      accessRefreshInProgress.current = false;
    }
  }
  refreshAccessRef.current = () => void refreshAccess();

  useEffect(() => {
    if (!accountMenuOpen && !demoMenuOpen) return;
    const closeAccountMenu = (event: PointerEvent) => {
      if (!accountMenu.current?.contains(event.target as Node)) {
        setAccountMenuOpen(false);
      }
      if (!demoMenu.current?.contains(event.target as Node)) {
        setDemoMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeAccountMenu);
    return () => document.removeEventListener("pointerdown", closeAccountMenu);
  }, [accountMenuOpen, demoMenuOpen]);

  useEffect(() => {
    if (!serverSettingsOpen || addFriendsOpen || deleteServerOpen) return;
    const closeServerSettings = (event: PointerEvent) => {
      if (!serverSettingsMenu.current?.contains(event.target as Node)) {
        setServerSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeServerSettings);
    return () =>
      document.removeEventListener("pointerdown", closeServerSettings);
  }, [serverSettingsOpen, addFriendsOpen, deleteServerOpen]);

  useEffect(() => {
    if (!messageMenu) return;
    const closeMessageMenu = (event: PointerEvent) => {
      if (!messageContextMenu.current?.contains(event.target as Node)) {
        setMessageMenu(null);
      }
    };
    const closeMessageMenuOnScroll = () => setMessageMenu(null);
    document.addEventListener("pointerdown", closeMessageMenu);
    document.addEventListener("scroll", closeMessageMenuOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeMessageMenu);
      document.removeEventListener("scroll", closeMessageMenuOnScroll, true);
    };
  }, [messageMenu]);

  useEffect(() => {
    if (!memberMenu) return;
    const closeMemberMenu = (event: PointerEvent) => {
      if (!memberContextMenu.current?.contains(event.target as Node)) {
        setMemberMenu(null);
      }
    };
    const closeOnScroll = () => setMemberMenu(null);
    document.addEventListener("pointerdown", closeMemberMenu);
    document.addEventListener("scroll", closeOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeMemberMenu);
      document.removeEventListener("scroll", closeOnScroll, true);
    };
  }, [memberMenu]);

  useEffect(() => {
    const selected = channels.find(
      (channel) => channel.id === selectedChannelId,
    );
    if (!selectedChannelId || selected?.type !== "text") {
      return;
    }
    void fetch(`/api/channels/${selectedChannelId}/messages`)
      .then(async (response) => {
        const data = await readJsonResponse<unknown>(response);
        if (!response.ok) throw new Error(apiErrorMessage(data));
        return data;
      })
      .then((data: unknown) => {
        if (
          !data ||
          typeof data !== "object" ||
          !Array.isArray((data as { messages?: unknown }).messages)
        )
          return;
        const page = data as {
          messages: Parameters<typeof toChatMessage>[0][];
          nextCursor: {
            beforeCreatedAt: string;
            beforeId: string;
          } | null;
        };
        setMessages(page.messages.map(toChatMessage));
        setNextMessageCursor(page.nextCursor);
      })
      .catch((error: unknown) =>
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Messages could not be loaded.",
        ),
      );
  }, [channels, selectedChannelId]);

  async function loadMoreMessages() {
    if (!selectedChannelId || !nextMessageCursor || loadingMoreMessages) return;
    setLoadingMoreMessages(true);
    try {
      const parameters = new URLSearchParams(nextMessageCursor);
      const response = await fetch(
        `/api/channels/${selectedChannelId}/messages?${parameters}`,
      );
      const data = await readJsonResponse<{
        messages?: Parameters<typeof toChatMessage>[0][];
        nextCursor?: { beforeCreatedAt: string; beforeId: string } | null;
      }>(response);
      if (!response.ok) throw new Error(apiErrorMessage(data));
      const messageRows = data.messages;
      if (!Array.isArray(messageRows)) return;
      setMessages((current) => [...messageRows.map(toChatMessage), ...current]);
      setNextMessageCursor(data.nextCursor ?? null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Older messages could not be loaded.",
      );
    } finally {
      setLoadingMoreMessages(false);
    }
  }

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
        setErrorMessage((current) =>
          current === "Live messaging is reconnecting." ? "" : current,
        );
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
          messageId?: string;
          permanent?: boolean;
        };
        if (
          incoming.type === "message-deleted" &&
          incoming.channelId === selectedChannelId &&
          incoming.messageId
        ) {
          setMessages((current) =>
            current
              .filter(
                (message) =>
                  !incoming.permanent || message.id !== incoming.messageId,
              )
              .map((message) =>
                message.id === incoming.messageId
                  ? { ...message, text: "Deleted message", deleted: true }
                  : message.replyTo?.id === incoming.messageId
                    ? {
                        ...message,
                        replyTo: incoming.permanent
                          ? null
                          : {
                              ...message.replyTo!,
                              text: "Deleted message",
                            },
                      }
                    : message,
              ),
          );
          return;
        }
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
      remoteAudio.current?.pause();
      if (remoteAudio.current) remoteAudio.current.srcObject = null;
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [remoteAudio],
  );

  useEffect(() => {
    const currentUserId = session?.user.id;
    if (authStatus !== "authenticated" || !currentUserId) return;
    const livePresence = createReconnectingSignalingConnection({
      onSocket: (openedSocket) => {
        presenceSocket.current = openedSocket;
      },
      onOpen: (openedSocket) => {
        if (selectedServerIdRef.current) {
          openedSocket.send(
            JSON.stringify({
              type: "subscribe-online",
              serverId: selectedServerIdRef.current,
            }),
          );
        }
        openedSocket.send(
          JSON.stringify({
            type: "subscribe-presence",
            roomIds: voiceChannelIdsRef.current,
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
        if (message.type === "access-changed") {
          invalidateSignalingToken();
          refreshAccessRef.current();
          return;
        }
        if (
          message.type === "presence" &&
          message.roomId &&
          Array.isArray(message.participants)
        ) {
          const participants = message.participants.map(normalizePresence);
          if (message.roomId === directRoomId.current) {
            setDirectRemoteSpeaking(
              participants.some(
                (participant) =>
                  participant.userId !== currentUserId && participant.speaking,
              ),
            );
          }
          setVoicePresence((current) => ({
            ...current,
            [message.roomId!]: participants,
          }));
        }
        if (
          message.type === "online-presence" &&
          message.serverId === selectedServerIdRef.current &&
          Array.isArray(message.userIds)
        ) {
          setOnlineUserIds([...new Set([...message.userIds, currentUserId])]);
        }
        if (message.type === "friendship-changed") {
          void loadFriends();
          invalidateSignalingToken();
          setSignalingRefreshKey((current) => current + 1);
        }
        if (
          message.type === "direct-message-deleted" &&
          message.fromUserId &&
          message.messageId
        ) {
          if (selectedFriendId.current === message.fromUserId) {
            setDirectMessages((current) =>
              current
                .filter(
                  (entry) =>
                    !message.permanent || entry.id !== message.messageId,
                )
                .map((entry) =>
                  entry.id === message.messageId
                    ? { ...entry, text: "Deleted message", deleted: true }
                    : entry,
                ),
            );
          }
          void loadFriends();
        }
        if (
          message.type === "direct-message" &&
          message.fromUserId &&
          message.message
        ) {
          const directMessage = toChatMessage(message.message);
          void loadFriends();
          if (
            friendsViewRef.current &&
            selectedFriendId.current === message.fromUserId &&
            document.visibilityState === "visible"
          ) {
            setDirectMessages((current) =>
              current.some((candidate) => candidate.id === directMessage.id)
                ? current
                : [...current, directMessage],
            );
          } else {
            setUnreadDirectMessages((current) => ({
              ...current,
              [message.fromUserId!]: (current[message.fromUserId!] ?? 0) + 1,
            }));
          }
        }
        if (
          message.type === "call-invite" &&
          message.fromUserId &&
          message.fromName &&
          message.roomId &&
          !directRoomId.current
        ) {
          setIncomingCall({
            fromUserId: message.fromUserId,
            fromName: message.fromName,
            roomId: message.roomId,
          });
        }
        if (
          message.type === "call-decline" &&
          message.fromName &&
          directRoomId.current
        ) {
          recordCallOutcomeRef.current("call-declined");
          closeCallViewRef.current();
        }
        if (message.type === "call-cancel") setIncomingCall(null);
      },
      // Presence reconnects automatically; a brief interruption does not need
      // a user-facing error because the participant list repairs itself.
      onError: () => undefined,
    });
    return () => {
      livePresence.close();
      presenceSocket.current = null;
    };
  }, [authStatus, session?.user.id, signalingRefreshKey]);

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
        // The real-time presence subscription supplies subsequent updates.
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

  function prepareRemoteAudio() {
    if (!remoteAudio.current) throw new Error("Call audio is not mounted");
    remoteAudio.current.setAttribute("playsinline", "");
    return remoteAudio.current;
  }

  async function playRemoteAudio() {
    const audio = prepareRemoteAudio();
    if (!audio.srcObject) return;
    try {
      await audio.play();
      setAudioPlaybackBlocked(false);
    } catch {
      setAudioPlaybackBlocked(true);
    }
  }

  function startDirectSpeechMonitor() {
    stopSpeechMonitor.current?.();
    const audioTrack = stream.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    stopSpeechMonitor.current = monitorVoiceActivity(audioTrack, (speaking) => {
      setDirectLocalSpeaking(speaking);
      setDirectParticipantSpeaking(session?.user.id, speaking);
      send({
        type: "media-state",
        muted: !audioTrack.enabled,
        camera: Boolean(stream.current?.getVideoTracks()[0]?.enabled),
        screen: false,
        speaking,
      });
    });
  }

  function setDirectParticipantSpeaking(
    userId: string | undefined,
    speaking: boolean,
    remote = false,
  ) {
    const roomId = directRoomId.current;
    if (!roomId) return;
    setVoicePresence((current) => ({
      ...current,
      [roomId]: (current[roomId] ?? []).map((participant) =>
        userId
          ? participant.userId === userId
            ? { ...participant, speaking }
            : participant
          : participant.userId !== session?.user.id && remote
            ? { ...participant, speaking }
            : participant,
      ),
    }));
  }

  async function ensureConnection() {
    if (connection.current) return connection.current;
    if (creatingConnection.current) return creatingConnection.current;
    const generation = peerGeneration.current;
    const pending = buildConnection(generation);
    creatingConnection.current = pending;
    try {
      return await pending;
    } finally {
      if (creatingConnection.current === pending)
        creatingConnection.current = null;
    }
  }

  async function buildConnection(generation: number) {
    const iceServers = await loadIceServers();
    if (generation !== peerGeneration.current)
      throw new Error("Call changed during negotiation");

    const peer = new RTCPeerConnection({ iceServers });
    const gatheredCandidates = new Map<string, number>();
    let iceError = "";
    stream.current?.getTracks().forEach((track) => {
      const sender = peer.addTrack(track, stream.current!);
      if (track.kind === "video") {
        void preferVideoDetail(sender);
      } else {
        track.contentHint = "speech";
        void preferResilientAudio(sender);
        preferOpus(peer, sender);
      }
    });
    if (!stream.current?.getAudioTracks().length) {
      peer.addTransceiver("audio", { direction: "recvonly" });
    }

    peer.onicecandidate = (event) => {
      if (connection.current !== peer) return;
      if (event.candidate) {
        const type = event.candidate.type ?? "unknown";
        gatheredCandidates.set(type, (gatheredCandidates.get(type) ?? 0) + 1);
        send({ type: "candidate", candidate: event.candidate.toJSON() });
      }
    };
    peer.onicecandidateerror = (event) => {
      iceError = ` / ICE server error ${event.errorCode}`;
    };
    peer.ontrack = (event) => {
      if (connection.current !== peer) return;
      if (event.track.kind === "audio") {
        preferStableAudio(event.receiver);
        const audio = prepareRemoteAudio();
        audio.srcObject = new MediaStream([event.track]);
        void playRemoteAudio();
      }
      if (event.track.kind === "video") {
        remoteVisualStream.current = new MediaStream([event.track]);
        if (remoteVideo.current)
          remoteVideo.current.srcObject = remoteVisualStream.current;
        setRemoteHasVideo(true);
        event.track.addEventListener("ended", () => setRemoteHasVideo(false), {
          once: true,
        });
      }
      setStatus("Remote audio negotiated; checking media connection…");
    };
    peer.onconnectionstatechange = () => {
      if (peer !== connection.current) return;
      if (peer.connectionState === "connected") setStatus("Media connected");
      if (["disconnected", "failed"].includes(peer.connectionState)) {
        setStatus("Guest disconnected");
      }
    };
    connection.current = peer;
    stopDirectStats.current?.();
    stopDirectStats.current = monitorPeerVideo(
      peer,
      (stats) => {
        if (connection.current === peer) setDirectVideoStats(stats);
      },
      (ping) => {
        if (connection.current !== peer) return;
        setDirectPing(ping);
        setChannelPing((current) => ({
          ...current,
          [activeVoiceChannelId]: ping,
        }));
      },
      (diagnostics) => {
        if (connection.current !== peer) return;
        const track = stream.current?.getAudioTracks()[0];
        const settings = track?.getSettings();
        setCallDiagnostics({
          ...diagnostics,
          connectivity: `${iceServers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/.test(url))) ? "TURN configured" : "STUN only"} / gathered ${[...gatheredCandidates].map(([type, count]) => `${type}: ${count}`).join(", ") || "none"}${iceError}`,
          negotiation: `ICE ${peer.iceConnectionState} / gathering ${peer.iceGatheringState} / SDP ${peer.signalingState} / local ${peer.localDescription?.type ?? "none"} / remote ${peer.remoteDescription?.type ?? "none"}`,
          playback: !remoteAudio.current?.srcObject
            ? "No remote audio track"
            : remoteAudio.current.paused
              ? "Paused or blocked — use Enable sound"
              : "Playing",
          microphone: track
            ? `${track.readyState}${track.muted ? " / capture interrupted" : ""}${!track.enabled ? " / muted" : ""} / ${settings?.sampleRate ?? "?"} Hz`
            : "unavailable",
        });
      },
    );
    return peer;
  }

  async function createOffer() {
    const peer = await ensureConnection();
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (connection.current !== peer) return;
    send({ type: "offer", sdp: peer.localDescription!.toJSON() });
    setStatus("Calling guest...");
  }

  async function addPendingCandidates(peer: RTCPeerConnection) {
    const candidates = pendingCandidates.current.splice(0);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }

  async function handleSignal(
    message: Signal | { type: "chat"; text: string },
  ) {
    if (message.type === "voice-kicked") {
      setNoticeMessage(
        "You were disconnected from the voice channel by its owner.",
      );
      returnToPreviousTextChannel();
      return;
    }
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
      setCallPeerPresent(true);
      playVoiceSound("join");
      connection.current?.restartIce();
      await createOffer();
      send({ type: "camera-state", enabled: !cameraOff });
      return;
    }
    if (message.type === "offer" && "sdp" in message && message.sdp) {
      setCallPeerPresent(true);
      const peer = await ensureConnection();
      await peer.setRemoteDescription(message.sdp);
      await addPendingCandidates(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (connection.current !== peer) return;
      send({ type: "answer", sdp: peer.localDescription!.toJSON() });
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
    if (message.type === "peer-left" || message.type === "hangup") {
      playVoiceSound("leave");
      if (!directRoomId.current.startsWith("friend:")) {
        peerGeneration.current += 1;
        creatingConnection.current = null;
        connection.current?.close();
        connection.current = null;
        pendingCandidates.current = [];
        stopRemoteSpeechMonitor.current?.();
        stopRemoteSpeechMonitor.current = null;
        stopDirectStats.current?.();
        stopDirectStats.current = null;
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        remoteVisualStream.current = null;
        if (remoteAudio.current) remoteAudio.current.srcObject = null;
        setRemoteHasVideo(false);
        setRemoteVideoQuality("");
        setDirectRemoteSpeaking(false);
        setCallDiagnostics(null);
        setDirectPing(null);
        setDirectVideoStats("");
        setCallPeerPresent(false);
        setStatus("Waiting for another person...");
        return;
      }
      friendCallStartedAt.current = 0;
      friendCallPartnerId.current = "";
      setCallPeerPresent(false);
      returnToPreviousTextChannel();
      if (selectedFriend) {
        void fetch(`/api/direct-messages/${selectedFriend.id}`)
          .then((response) => response.json())
          .then((data) =>
            setDirectMessages(
              Array.isArray(data) ? data.map(toChatMessage) : [],
            ),
          );
      }
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
    prepareVoiceActivity();
    selectMicrophone(deviceId);
    if (!joined || !stream.current) return;
    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(deviceId),
      });
      const nextTrack = replacement.getAudioTracks()[0];
      nextTrack.contentHint = "speech";
      const oldTrack = stream.current.getAudioTracks()[0];
      nextTrack.enabled = oldTrack?.enabled ?? !muted;
      const sender = connection.current
        ?.getSenders()
        .find((candidate) => candidate.track?.kind === "audio");
      if (sender) {
        await sender.replaceTrack(nextTrack);
        await preferResilientAudio(sender);
      }
      if (oldTrack) {
        stream.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      stream.current.addTrack(nextTrack);
      setMuted(!nextTrack.enabled);
      startDirectSpeechMonitor();
      send({
        type: "media-state",
        muted: !nextTrack.enabled,
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
    if (present || activeGroupChannelId.current === channelId)
      activeGroupChannelId.current = present ? channelId : "";
    setConnectedGroupChannelId((current) =>
      present ? channelId : current === channelId ? "" : current,
    );
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
          audio: audioConstraints(microphoneId),
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
    const receiveSignal = createSignalQueue<Signal>(
      async (message) => {
        if (socket.current === ws) await handleSignal(message);
      },
      (error) => {
        if (socket.current !== ws) return;
        setStatus("WebRTC negotiation failed");
        setErrorMessage(
          `WebRTC negotiation failed: ${error instanceof Error ? error.name + ": " + error.message : "unknown error"}`,
        );
      },
    );
    ws.onmessage = (event) => {
      void receiveSignal(JSON.parse(event.data));
    };
    ws.onerror = () => {
      setJoining(false);
      setStatus("Cannot reach signaling server");
      setErrorMessage(
        "Cannot reach the signaling server. Make sure npm run dev:all is running.",
      );
    };
    ws.onclose = () => {
      if (socket.current !== ws) return;
      if (socket.current === ws) socket.current = null;
      setJoining(false);
      setJoined(false);
      setStatus("Signaling disconnected");
      peerGeneration.current += 1;
      creatingConnection.current = null;
      stopDirectStats.current?.();
      stopDirectStats.current = null;
      connection.current?.close();
      connection.current = null;
      pendingCandidates.current = [];
      scheduleDirectReconnect(channelId);
    };
  }

  function stopMedia() {
    stopSpeechMonitor.current?.();
    stopSpeechMonitor.current = null;
    stopRemoteSpeechMonitor.current?.();
    stopRemoteSpeechMonitor.current = null;
    stopDirectStats.current?.();
    stopDirectStats.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
  }

  function leaveRoom() {
    setAudioPlaybackBlocked(false);
    peerGeneration.current += 1;
    creatingConnection.current = null;
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
    remoteVisualStream.current = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
    setJoined(false);
    setJoining(false);
    setMuted(false);
    setCameraOff(true);
    setRemoteHasVideo(false);
    setCallPeerPresent(false);
    setLocalVideoQuality("");
    setRemoteVideoQuality("");
    setDirectVideoStats("");
    setCallDiagnostics(null);
    setDirectPing(null);
    setDirectLocalSpeaking(false);
    setDirectRemoteSpeaking(false);
    setStatus("Not connected");
    setFocusedDirectVideo(null);
    if (wasConnected) playVoiceSound("leave");
  }
  leaveRoomRef.current = leaveRoom;

  function returnToPreviousTextChannel() {
    leaveRoom();
    setVoiceJoinTarget("");
    setActiveVoiceChannelId("");
    setActiveVoiceChannelSnapshot(null);
    setCallViewOpen(false);
    const fallback = channels.find((channel) => channel.type === "text")?.id;
    setSelectedChannelId(lastTextChannelId.current || fallback || "");
  }
  closeCallViewRef.current = returnToPreviousTextChannel;

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
    try {
      const response = await fetch(
        `/api/channels/${selectedChannelId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, replyToId: replyingTo?.id }),
        },
      );
      const message =
        await readJsonResponse<Parameters<typeof toChatMessage>[0]>(response);
      if (!response.ok) throw new Error(apiErrorMessage(message));
      setDraft("");
      setReplyingTo(null);
      const chatMessage = toChatMessage(message);
      setMessages((current) =>
        current.some((candidate) => candidate.id === chatMessage.id)
          ? current
          : [...current, chatMessage],
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The message could not be sent.",
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
      await switchServer(server.id);
      closeForm();
      setNoticeMessage("Server created.");
    } else setErrorMessage(server.error ?? "Server could not be created.");
  }

  async function deleteServer() {
    if (!selectedServerId) return;
    const response = await fetch("/api/servers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: selectedServerId }),
    });
    const result = await response.json();
    if (!response.ok)
      return setErrorMessage(result.error ?? "Server could not be deleted.");
    setServers((current) =>
      current.filter((server) => server.id !== selectedServerId),
    );
    setSelectedServerId(
      servers.find((server) => server.id !== selectedServerId)?.id ?? "",
    );
    setDeleteServerOpen(false);
    setServerSettingsOpen(false);
    setNoticeMessage("Server deleted.");
  }

  async function addSelectedFriendsToServer() {
    if (!selectedServerId || selectedServerFriendIds.length === 0) return;
    const response = await fetch(`/api/servers/${selectedServerId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds: selectedServerFriendIds }),
    });
    const result = await response.json();
    if (!response.ok)
      return setErrorMessage(result.error ?? "Friends could not be added.");
    const addedIds = new Set<string>(result.added ?? []);
    setMembers((current) => [
      ...current,
      ...friends
        .filter((friend) => addedIds.has(friend.id))
        .map((friend) => ({
          id: friend.id,
          name: friend.name,
          image: friend.image,
          role: "member" as const,
        })),
    ]);
    setSelectedServerFriendIds([]);
    setNoticeMessage(
      `${addedIds.size} friend${addedIds.size === 1 ? "" : "s"} added to the server.`,
    );
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
      setNoticeMessage("Channel created.");
    } else setErrorMessage(channel.error ?? "Channel could not be created.");
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
      setNoticeMessage("Demo account created. Copy the invitation link now.");
    } else
      setErrorMessage(result.error ?? "Demo account could not be created.");
  }

  function openDemoAccount(serverId: string, chooseServer: boolean) {
    setAccountMenuOpen(false);
    setDemoMenuOpen(false);
    setInviteServerId(serverId);
    setChooseInviteServer(chooseServer);
    setInviteUrl("");
    setForm("account");
  }

  async function openDemoAccountManager() {
    setAccountMenuOpen(false);
    setDemoMenuOpen(false);
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
    if (!response.ok) return setErrorMessage("Access could not be revoked.");
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
    setNoticeMessage("Demo account access revoked.");
  }

  async function saveDemoServers(account: DemoAccount) {
    const response = await fetch("/api/demo-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        demoUserId: account.id,
        action: "servers",
        serverIds: editingDemoServers,
      }),
    });
    if (!response.ok)
      return setErrorMessage("Server assignments could not be saved.");
    setDemoAccounts((current) =>
      current.map((candidate) =>
        candidate.id === account.id
          ? {
              ...candidate,
              servers: servers.filter((server) =>
                editingDemoServers.includes(server.id),
              ),
            }
          : candidate,
      ),
    );
    setEditingDemoAccount(null);
    if (selectedServerId) {
      const membersResponse = await fetch(
        `/api/servers/${selectedServerId}/members`,
      );
      const latestMembers = await membersResponse.json();
      if (membersResponse.ok && Array.isArray(latestMembers)) {
        setMembers(latestMembers);
      }
    }
    setNoticeMessage("Server access updated.");
  }

  async function openDemoServerAssignments(account: DemoAccount) {
    const response = await fetch("/api/servers");
    const latestServers = await readJsonResponse<Server[]>(response);
    if (!response.ok || !Array.isArray(latestServers)) {
      setErrorMessage("Servers could not be refreshed.");
      return;
    }
    setServers(latestServers);
    setEditingDemoServers(account.servers.map((server) => server.id));
    setEditingDemoAccount(account);
  }

  async function regenerateDemoInvite(account: DemoAccount) {
    const response = await fetch("/api/demo-accounts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demoUserId: account.id, action: "regenerate" }),
    });
    const result = await readJsonResponse<{
      inviteUrl?: string;
      expiresAt?: string;
      status?: DemoAccount["status"];
      error?: string;
    }>(response);
    if (!response.ok || !result.inviteUrl)
      return setErrorMessage(
        result.error ?? "Invitation could not be generated.",
      );
    setDemoInviteLinks((current) => ({
      ...current,
      [account.id]: result.inviteUrl!,
    }));
    setDemoAccounts((current) =>
      current.map((candidate) =>
        candidate.id === account.id
          ? {
              ...candidate,
              expiresAt: result.expiresAt ?? candidate.expiresAt,
              status: result.status ?? candidate.status,
            }
          : candidate,
      ),
    );
    setRegenerateInviteCandidate(null);
    setNoticeMessage(
      "A new invitation link was generated. The old link no longer works.",
    );
  }

  async function extendDemoAccess(event: FormEvent) {
    event.preventDefault();
    if (!extendingDemoAccount || extendingDemoAccess) return;
    setExtendingDemoAccess(true);
    try {
      const response = await fetch("/api/demo-accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demoUserId: extendingDemoAccount.id,
          action: "extend",
          extensionHours: Number(demoExtensionHours),
        }),
      });
      const result = await readJsonResponse<{
        id?: string;
        expiresAt?: string;
        error?: string;
      }>(response);
      if (!response.ok || !result.expiresAt)
        throw new Error(result.error ?? "Demo access could not be extended.");
      setDemoAccounts((current) =>
        current.map((account) =>
          account.id === result.id
            ? { ...account, expiresAt: result.expiresAt! }
            : account,
        ),
      );
      setExtendingDemoAccount(null);
      setNoticeMessage(
        `Demo access extended until ${formatLocalDateTime(result.expiresAt)}.`,
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Demo access could not be extended.",
      );
    } finally {
      setExtendingDemoAccess(false);
    }
  }

  async function deleteDemoAccount() {
    if (!deleteDemoCandidate) return;
    const response = await fetch("/api/demo-accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        demoUserId: deleteDemoCandidate.id,
        deleteMessages: deleteDemoMessages,
      }),
    });
    if (!response.ok)
      return setErrorMessage("The demo account could not be deleted.");
    setDemoAccounts((current) =>
      current.filter((account) => account.id !== deleteDemoCandidate.id),
    );
    setMembers((current) =>
      current.filter((member) => member.id !== deleteDemoCandidate.id),
    );
    setDeleteDemoCandidate(null);
    setDeleteDemoMessages(false);
    setNoticeMessage("Demo account deleted.");
  }

  async function kickMember(userId: string) {
    const response = await fetch(`/api/servers/${selectedServerId}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok)
      return setErrorMessage("The member could not be removed.");
    setMembers((current) => current.filter((member) => member.id !== userId));
    setKickCandidate(null);
    setMemberMenu(null);
    setNoticeMessage("Member removed from the server.");
  }

  async function kickVoiceParticipant(userId: string, channelId: string) {
    const response = await fetch(
      `/api/servers/${selectedServerId}/voice-kick`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, channelId }),
      },
    );
    if (!response.ok) {
      setErrorMessage("Could not disconnect this person from voice.");
      return;
    }
    setNoticeMessage("Participant disconnected from voice.");
  }

  async function openAccountMessages(
    userId: string,
    name: string,
    fromDemoManager = false,
  ) {
    setAccountMenuOpen(false);
    setMessageAccount({ id: userId, name });
    setDeleteMessagesPending(false);
    setReturnToDemoManager(fromDemoManager);
    setForm("messages");
    try {
      const response = await fetch(`/api/users/${userId}/messages`);
      const data = await readJsonResponse<unknown>(response);
      if (!response.ok) throw new Error(apiErrorMessage(data));
      setAccountMessages(Array.isArray(data) ? data : []);
    } catch (error) {
      setAccountMessages([]);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Account messages could not be loaded.",
      );
    }
  }

  async function deleteAccountMessages() {
    const response = await fetch(`/api/users/${messageAccount.id}/messages`, {
      method: "DELETE",
    });
    if (!response.ok) return;
    setAccountMessages([]);
    setDeleteMessagesPending(false);
  }

  function requestMessageDeletion(
    messageId: string,
    preview: string,
    conversationUserId?: string,
  ) {
    setMessageMenu(null);
    setErrorMessage("");
    setPermanentMessageDeletion(false);
    setDeleteMessageCandidate({ id: messageId, preview, conversationUserId });
  }

  async function deleteMessage() {
    if (!deleteMessageCandidate) return;
    const candidate = deleteMessageCandidate;
    const response = await fetch(
      candidate.conversationUserId
        ? `/api/direct-messages/${candidate.conversationUserId}/${candidate.id}`
        : `/api/messages/${candidate.id}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permanent: permanentMessageDeletion }),
      },
    );
    if (!response.ok) {
      setErrorMessage("The message could not be deleted.");
      return;
    }
    if (candidate.conversationUserId) {
      if (selectedFriendId.current === candidate.conversationUserId) {
        setDirectMessages((current) =>
          current
            .filter(
              (entry) => !permanentMessageDeletion || entry.id !== candidate.id,
            )
            .map((entry) =>
              entry.id === candidate.id
                ? { ...entry, text: "Deleted message", deleted: true }
                : entry,
            ),
        );
      }
      void loadFriends();
      setDeleteMessageCandidate(null);
      setPermanentMessageDeletion(false);
      return;
    }
    setMessages((current) =>
      current
        .filter(
          (message) =>
            !permanentMessageDeletion ||
            message.id !== deleteMessageCandidate.id,
        )
        .map((message) =>
          message.id === deleteMessageCandidate.id
            ? { ...message, text: "Deleted message", deleted: true }
            : message.replyTo?.id === deleteMessageCandidate.id
              ? {
                  ...message,
                  replyTo: permanentMessageDeletion
                    ? null
                    : { ...message.replyTo, text: "Deleted message" },
                }
              : message,
        ),
    );
    setAccountMessages((current) =>
      current.filter((message) => message.id !== deleteMessageCandidate.id),
    );
    setMessageMenu(null);
    setDeleteMessageCandidate(null);
    setPermanentMessageDeletion(false);
  }

  function closeCurrentForm() {
    if (form === "messages" && returnToDemoManager) {
      setForm("manage");
      setAccountMessages([]);
      setDeleteMessagesPending(false);
      setReturnToDemoManager(false);
      return;
    }
    closeForm();
  }

  function closeForm() {
    setForm(null);
    setFormName("");
    setInviteUrl("");
    setChooseInviteServer(false);
    setRevokeCandidateId("");
    setDeleteMessagesPending(false);
    setReturnToDemoManager(false);
  }

  async function saveRename(event: FormEvent) {
    event.preventDefault();
    if (!renameTarget) return;
    const name = renameTarget.name.trim();
    if (!name) return;
    const endpoint =
      renameTarget.kind === "user"
        ? "/api/users/me"
        : renameTarget.kind === "demo"
          ? "/api/demo-accounts"
          : renameTarget.kind === "server"
            ? "/api/servers"
            : `/api/servers/${selectedServerId}/channels`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        ...(renameTarget.kind === "demo"
          ? { demoUserId: renameTarget.id, action: "rename" }
          : renameTarget.kind === "server"
            ? { serverId: renameTarget.id }
            : renameTarget.kind === "channel"
              ? { channelId: renameTarget.id }
              : {}),
      }),
    });
    const result = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      setErrorMessage(result?.error ?? "The name could not be changed.");
      return;
    }
    if (renameTarget.kind === "demo") {
      setDemoAccounts((current) =>
        current.map((account) =>
          account.id === renameTarget.id ? { ...account, name } : account,
        ),
      );
      setMembers((current) =>
        current.map((member) =>
          member.id === renameTarget.id ? { ...member, name } : member,
        ),
      );
    } else if (renameTarget.kind === "server") {
      setServers((current) =>
        current.map((server) =>
          server.id === renameTarget.id ? { ...server, name } : server,
        ),
      );
    } else if (renameTarget.kind === "channel") {
      setChannels((current) =>
        current.map((channel) =>
          channel.id === renameTarget.id ? { ...channel, name } : channel,
        ),
      );
      setActiveVoiceChannelSnapshot((current) =>
        current?.id === renameTarget.id ? { ...current, name } : current,
      );
    }
    setRenameTarget(null);
    setNoticeMessage(
      renameTarget.kind === "user"
        ? "Username changed. Reloading your session..."
        : `${
            renameTarget.kind === "server"
              ? "Server"
              : renameTarget.kind === "channel"
                ? "Channel"
                : "Demo account"
          } renamed.`,
    );
    if (renameTarget.kind === "user") location.reload();
  }

  function selectVoiceChannel(channel: Channel) {
    if (activeVoiceChannelId === channel.id) return;
    prepareVoiceActivity();
    prepareRemoteAudio();
    prepareVoiceSounds();
    leaveRoom();
    setActiveVoiceChannelId(channel.id);
    setActiveVoiceChannelSnapshot(channel);
    setCallViewOpen(false);
    setVoiceJoinTarget(channel.id);
    setVoiceJoinKey((current) => current + 1);
    setCallPeerPresent(false);
    if (channel.type === "voice_direct") {
      if (channel.id.startsWith("friend:"))
        friendCallStartedAt.current = Date.now();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => void joinRoom(channel.id));
      });
    }
  }

  const visibleMembers = members.filter((member) =>
    member.name.toLowerCase().includes(memberSearch.trim().toLowerCase()),
  );
  const onlineMembers = visibleMembers.filter((member) =>
    onlineUserIds.includes(member.id),
  );
  const offlineMembers = visibleMembers.filter(
    (member) => !onlineUserIds.includes(member.id),
  );
  const activeVoiceChannel = activeVoiceChannelSnapshot;
  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId,
  );
  const displayedChannel =
    callViewOpen && activeVoiceChannel ? activeVoiceChannel : selectedChannel;
  const isSelectedServerOwner = members.some(
    (member) => member.id === session?.user.id && member.role === "owner",
  );
  const availableServerFriends = friends.filter(
    (friend) =>
      friend.status === "accepted" &&
      !members.some((member) => member.id === friend.id) &&
      `${friend.name} ${friend.handle} ${formatUserHandle(friend.handle)}`
        .toLowerCase()
        .includes(serverFriendSearch.trim().toLowerCase()),
  );
  const incomingCallOverlay = incomingCall && (
    <div className="incomingCall" role="dialog" aria-live="assertive">
      <div>
        <small>Incoming call</small>
        <strong>{incomingCall.fromName}</strong>
      </div>
      <button type="button" className="danger" onClick={declineIncomingCall}>
        Decline
      </button>
      <button type="button" className="primary" onClick={answerIncomingCall}>
        Answer
      </button>
    </div>
  );

  const connectionLabel =
    activeVoiceChannel &&
    (joined || connectedGroupChannelId === activeVoiceChannel.id)
      ? `Connected to "${activeVoiceChannel.name}"`
      : activeVoiceChannel && joining
        ? `Connecting to "${activeVoiceChannel.name}"…`
        : "Not connected";
  const profilePanel = session && (
    <footer className="profileBar">
      <span className="avatar">
        {session.user.name?.[0]?.toUpperCase() ?? "Y"}
      </span>
      <div
        className={`accountMenu profileMenu ${accountMenuOpen ? "open" : ""}`}
        ref={accountMenu}
      >
        <button
          className={`accountMenuTrigger ${directLocalSpeaking ? "speaking" : ""}`}
          onClick={() => setAccountMenuOpen((current) => !current)}
        >
          <span>
            <strong title={session.user.name ?? "You"}>
              {session.user.name ?? "You"}
            </strong>
            {session.user.handle && (
              <small
                className="userHandle"
                title={formatUserHandle(session.user.handle)}
              >
                {formatUserHandle(session.user.handle)}
              </small>
            )}
            <small className="voiceConnectionStatus" title={connectionLabel}>
              {connectionLabel}
            </small>
          </span>
          <span aria-hidden="true">⌃</span>
        </button>
        {accountMenuOpen && (
          <div className="accountMenuDropdown">
            <button
              onClick={() => {
                setAccountMenuOpen(false);
                setFriendsView(false);
                setForm("media");
                void loadMediaDevices();
              }}
            >
              Voice &amp; video settings
            </button>
            <button
              onClick={() => {
                setFriendsView(false);
                void openAccountMessages(
                  session.user.id,
                  session.user.name ?? "My account",
                );
              }}
            >
              My messages
            </button>
            <button
              onClick={() => {
                setAccountMenuOpen(false);
                setFriendsView(false);
                setRenameTarget({
                  kind: "user",
                  id: session.user.id,
                  name: session.user.name ?? "",
                });
              }}
            >
              Change username
            </button>
            <button onClick={() => void signOut({ callbackUrl: "/login" })}>
              Log out
            </button>
          </div>
        )}
      </div>
    </footer>
  );

  const legalLinks = (
    <footer className="appLegalLinks">
      <button type="button" onClick={() => setLegalDocument("impressum")}>
        Impressum
      </button>
      <button type="button" onClick={() => setLegalDocument("privacy")}>
        Privacy
      </button>
    </footer>
  );
  const legalOverlay = legalDocument && (
    <div
      className="modalBackdrop legalModalBackdrop"
      onMouseDown={() => setLegalDocument(null)}
    >
      <section
        className="legalModal"
        role="dialog"
        aria-modal="true"
        aria-label={
          legalDocument === "impressum" ? "Impressum" : "Privacy notice"
        }
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>
            {legalDocument === "impressum" ? "Impressum" : "Privacy notice"}
          </strong>
          <button
            type="button"
            aria-label="Close legal document"
            onClick={() => setLegalDocument(null)}
          >
            ×
          </button>
        </header>
        <iframe
          title={legalDocument === "impressum" ? "Impressum" : "Privacy notice"}
          src={`/${legalDocument}`}
        />
      </section>
    </div>
  );

  const panelClasses = `${serverListToggled ? "serverListToggled" : ""} ${channelsHidden ? "channelsHidden" : ""} ${userListToggled ? "userListToggled" : ""}`;
  const panelControls = (
    <nav className="panelControls" aria-label="Workspace panels">
      <button
        type="button"
        title="Show or hide servers"
        aria-label="Show or hide servers"
        onClick={() => setServerListToggled((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="7" height="7" rx="2" />
          <rect x="3" y="14" width="7" height="7" rx="2" />
          <path d="M14 6h7M14 17h7" />
        </svg>
      </button>
      <button
        type="button"
        title="Show or hide channels and conversations"
        aria-label="Show or hide channels and conversations"
        aria-expanded={!channelsHidden}
        onClick={() => setChannelsHidden((value) => !value)}
      >
        #
      </button>
      <button
        type="button"
        title="Show or hide users"
        aria-label="Show or hide users"
        onClick={() => setUserListToggled((value) => !value)}
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="9" cy="8" r="3" />
          <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" />
        </svg>
      </button>
    </nav>
  );
  const closeUserList = (
    <button
      type="button"
      className="closeUserList"
      aria-label="Close user list"
      onClick={() => setUserListToggled(false)}
    >
      ×
    </button>
  );
  const directDeletionDialog = deleteMessageCandidate?.conversationUserId && (
    <div
      className="modalBackdrop deletionConfirmationBackdrop"
      onMouseDown={() => setDeleteMessageCandidate(null)}
    >
      <section
        className="modalCard deletionConfirmation"
        role="dialog"
        aria-modal="true"
        aria-labelledby="direct-delete-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id="direct-delete-title">Delete message?</h2>
        <p>
          The content will be erased for both people and replaced with{" "}
          <em>Deleted message</em>.
        </p>
        <blockquote>{deleteMessageCandidate.preview}</blockquote>
        <label className="permanentDeleteOption">
          <input
            type="checkbox"
            checked={permanentMessageDeletion}
            onChange={(event) =>
              setPermanentMessageDeletion(event.target.checked)
            }
          />
          <span>
            Delete completely
            <small>
              Permanently removes the message from both histories. This cannot
              be undone.
            </small>
          </span>
        </label>
        {errorMessage && <p role="alert">{errorMessage}</p>}
        <div className="modalActions">
          <button type="button" onClick={() => setDeleteMessageCandidate(null)}>
            Cancel
          </button>
          <button
            className="danger"
            type="button"
            onClick={() => void deleteMessage()}
          >
            {permanentMessageDeletion ? "Delete permanently" : "Delete message"}
          </button>
        </div>
      </section>
    </div>
  );

  if (authStatus !== "authenticated" || !serversLoaded) {
    return (
      <main className="loginPage appLoadingPage">
        <span className="loadingSpinner" />
        <span>Loading LC...</span>
      </main>
    );
  }

  if (friendsView) {
    const acceptedFriends = friends.filter(
      (friend) => friend.status === "accepted",
    );
    const recentFriends = [...acceptedFriends]
      .filter((friend) => friend.lastActivityAt)
      .sort(
        (left, right) =>
          new Date(right.lastActivityAt!).getTime() -
          new Date(left.lastActivityAt!).getTime(),
      );
    const pendingRequests = friends.filter(
      (friend) => friend.status === "pending",
    );
    const visibleFriends = acceptedFriends.filter((friend) =>
      friendTab === "online"
        ? onlineUserIds.includes(friend.id)
        : !onlineUserIds.includes(friend.id),
    );
    return (
      <main className={`workspace friendsScreen ${panelClasses}`}>
        <aside className="workspaceRail">
          <button
            className="workspaceLogo"
            aria-label="Friends"
            onClick={() => undefined}
          >
            LC
            {notificationCount > 0 && (
              <span className="notificationBadge">{notificationCount}</span>
            )}
          </button>
          {servers.map((server) => (
            <div className="serverButtonWrap" key={server.id}>
              <button
                className="workspaceButton"
                aria-label={server.name}
                onClick={() => {
                  if (server.id === selectedServerId) {
                    setFriendsView(false);
                    return;
                  }
                  void switchServer(server.id).then(() =>
                    setFriendsView(false),
                  );
                }}
              >
                {server.name[0]?.toUpperCase()}
              </button>
              <span className="serverTooltip">{server.name}</span>
            </div>
          ))}
          {session.user.role !== "demo" && (
            <div className="serverButtonWrap">
              <button
                className="workspaceButton"
                aria-label="Create server"
                onClick={() => {
                  setFriendsView(false);
                  setForm("server");
                }}
              >
                +
              </button>
              <span className="serverTooltip" role="tooltip">
                Create a server
              </span>
            </div>
          )}
        </aside>
        <aside className="channelSidebar friendsSidebar">
          <header className="workspaceName">
            <button
              className="friendsHomeButton"
              type="button"
              onClick={() => setSelectedFriend(null)}
            >
              Friends
            </button>
          </header>
          <nav>
            {recentFriends.map((friend) => (
              <button
                className={`channel ${selectedFriend?.id === friend.id ? "active" : ""} ${(unreadDirectMessages[friend.id] ?? 0) > 0 ? "unread" : ""}`}
                key={friend.id}
                onClick={() => openFriend(friend)}
              >
                <span className="friendConversationTitle">
                  <b>{friend.name}</b>
                  {friend.lastMessage && (
                    <time>
                      {new Date(
                        friend.lastMessage.createdAt,
                      ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  )}
                </span>
                {friend.lastMessage && (
                  <small title={friend.lastMessage.text}>
                    {friend.lastMessage.text}
                  </small>
                )}
                {(unreadDirectMessages[friend.id] ?? 0) > 0 && (
                  <span className="conversationUnreadBadge">
                    {unreadDirectMessages[friend.id]}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {profilePanel}
        </aside>
        <section className="room friendsRoom">
          <header className="roomHeader">
            <strong>{selectedFriend?.name ?? "Friends"}</strong>
            {panelControls}
          </header>
          {!selectedFriend && (
            <div className="friendsContent">
              <form
                className="friendSearchForm"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchFriends();
                }}
              >
                <input
                  value={friendSearch}
                  onChange={(event) => {
                    const value = event.target.value;
                    setFriendSearch(value);
                    if (
                      value.trim().length >= 3 ||
                      value.includes(".") ||
                      value.includes("(")
                    ) {
                      void searchFriends(value);
                    } else {
                      setFriendResults([]);
                    }
                  }}
                  placeholder="Search friends"
                />
                <button>Search</button>
              </form>
              {friendResults
                .filter(
                  (result) =>
                    !friends.some((friend) => friend.id === result.id),
                )
                .map((friend) => (
                  <div className="friendRow" key={friend.id}>
                    <span>
                      <b>{friend.name}</b>
                      <small>{formatUserHandle(friend.handle)}</small>
                    </span>
                    <button
                      onClick={() => void friendAction("request", friend)}
                    >
                      Add friend
                    </button>
                  </div>
                ))}
              <div className="friendTabs">
                <button
                  className={friendTab === "online" ? "active" : ""}
                  onClick={() => setFriendTab("online")}
                >
                  Online
                </button>
                <button
                  className={friendTab === "offline" ? "active" : ""}
                  onClick={() => setFriendTab("offline")}
                >
                  Offline
                </button>
                <button
                  className={friendTab === "pending" ? "active" : ""}
                  onClick={() => setFriendTab("pending")}
                >
                  Pending invites
                  {incomingFriendRequestCount > 0 && (
                    <span className="tabBadge">
                      {incomingFriendRequestCount}
                    </span>
                  )}
                </button>
              </div>
              {friendTab === "pending" ? (
                <>
                  <p className="sectionLabel">PENDING INVITES</p>
                  {pendingRequests.map((friend) => (
                    <div className="friendRow" key={friend.id}>
                      <span>
                        <b>{friend.name}</b>
                        <small>{formatUserHandle(friend.handle)}</small>
                      </span>
                      {friend.incoming ? (
                        <>
                          <button
                            onClick={() => void friendAction("accept", friend)}
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => void friendAction("decline", friend)}
                          >
                            Decline
                          </button>
                        </>
                      ) : (
                        <small>Sent</small>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <p className="sectionLabel">{friendTab.toUpperCase()}</p>
                  {visibleFriends.map((friend) => (
                    <button
                      className="friendRow"
                      key={friend.id}
                      onClick={() => openFriend(friend)}
                    >
                      <span>
                        <b>{friend.name}</b>
                        <small>{formatUserHandle(friend.handle)}</small>
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {selectedFriend && (
            <section
              className={`chat directMessages ${activeVoiceChannel?.type === "voice_direct" ? "callActive" : ""}`}
            >
              <div className="chatLog">
                {directMessages.map((message) => (
                  <article
                    className={`${message.kind === "call" ? "callHistory" : ""} ${message.deleted ? "deletedMessage" : ""}`}
                    key={message.id}
                  >
                    {message.kind === "call" && !message.deleted ? (
                      <p>
                        {message.text}
                        {message.text === "Call ended" &&
                          ` · ${formatCallDuration(message.callDurationSeconds)}`}
                        <time>{message.time}</time>
                      </p>
                    ) : (
                      <>
                        <b>{message.author}</b>
                        <time>{message.time}</time>
                        <p>{message.text}</p>
                      </>
                    )}
                    {message.authorId === session.user.id &&
                      !message.deleted && (
                        <button
                          type="button"
                          className="directMessageDelete"
                          aria-label="Delete message"
                          title="Delete message"
                          onClick={() =>
                            requestMessageDeletion(
                              message.id,
                              message.text,
                              selectedFriend.id,
                            )
                          }
                        >
                          Delete
                        </button>
                      )}
                  </article>
                ))}
              </div>
              <form onSubmit={sendDirectMessage}>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={`Message ${selectedFriend.name}`}
                />
                <button>Send</button>
                <button
                  type="button"
                  onClick={() => void startFriendCall(selectedFriend)}
                >
                  Call
                </button>
              </form>
            </section>
          )}
          {activeVoiceChannel?.type === "voice_direct" && (
            <section className="friendsCallPanel" aria-live="polite">
              <div className="friendsCallIdentity">
                <small>{joined ? "Direct call" : "Calling"}</small>
                <strong className={directRemoteSpeaking ? "speaking" : ""}>
                  {activeVoiceChannel.name}
                </strong>
                <span>{joining ? "Connecting…" : status}</span>
                <ConnectionDiagnostics
                  ping={directPing}
                  diagnostics={callDiagnostics}
                />
              </div>
              <div className="friendsCallVideo">
                <video ref={remoteVideo} autoPlay muted playsInline />
                {!remoteHasVideo && (
                  <span>{activeVoiceChannel.name[0]?.toUpperCase()}</span>
                )}
                <video
                  className="localPreview"
                  ref={localVideo}
                  autoPlay
                  muted
                  playsInline
                />
              </div>
              <div className="controls voiceDock friendsCallControls">
                {audioPlaybackBlocked && (
                  <button type="button" onClick={() => void playRemoteAudio()}>
                    Enable sound
                  </button>
                )}
                <DeviceMenu
                  kind="microphone"
                  disabled={muted}
                  devices={microphones}
                  selectedId={microphoneId}
                  onAction={toggleAudio}
                  onRestart={() => void changeActiveMicrophone(microphoneId)}
                  onSelect={(deviceId) => void changeActiveMicrophone(deviceId)}
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
                  type="button"
                  onClick={endFriendCall}
                >
                  End call
                </button>
              </div>
            </section>
          )}
        </section>
        <aside className="memberSidebar friendsInfoSidebar">
          <header className="memberSidebarHeader">
            Profile{closeUserList}
          </header>
          <div className="memberScroll">
            {selectedFriend ? (
              <div className="friendProfileCard">
                <span className="avatar">
                  {selectedFriend.name[0]?.toUpperCase()}
                </span>
                <strong>{selectedFriend.name}</strong>
                <small>{formatUserHandle(selectedFriend.handle)}</small>
              </div>
            ) : (
              <p className="empty">Select a friend to view their profile.</p>
            )}
          </div>
          {legalLinks}
        </aside>
        {incomingCallOverlay}
        {legalOverlay}
        {directDeletionDialog}
      </main>
    );
  }

  if (serversLoaded && servers.length === 0) {
    return (
      <main className="noServerPage">
        <section>
          <button
            className="workspaceLogo noServerFriendsButton"
            aria-label="Friends"
            onClick={() => setFriendsView(true)}
          >
            LC
            {notificationCount > 0 && (
              <span className="notificationBadge">{notificationCount}</span>
            )}
          </button>
          <h1>No servers yet</h1>
          {session.user.role === "demo" ? (
            <p>
              Unfortunately, you currently don&apos;t have access to any
              servers. Please contact the owner.
            </p>
          ) : (
            <>
              <p>Create your first server to get started.</p>
              <form onSubmit={createServer}>
                <label>
                  Server name
                  <input
                    autoFocus
                    maxLength={60}
                    required
                    value={formName}
                    onChange={(event) => setFormName(event.target.value)}
                  />
                </label>
                <button type="submit">Create server</button>
              </form>
            </>
          )}
          <button onClick={() => void signOut({ callbackUrl: "/login" })}>
            Log out
          </button>
        </section>
        {incomingCallOverlay}
      </main>
    );
  }

  return (
    <main className={`workspace ${panelClasses}`}>
      <aside className="workspaceRail" aria-label="Workspaces">
        <button
          className="workspaceLogo"
          aria-label="Friends"
          onClick={() => setFriendsView(true)}
        >
          LC
          {notificationCount > 0 && (
            <span className="notificationBadge">{notificationCount}</span>
          )}
        </button>
        {servers.map((server) => (
          <div className="serverButtonWrap" key={server.id}>
            <button
              className={`workspaceButton ${server.id === selectedServerId ? "active" : ""}`}
              aria-label={server.name}
              onClick={() => {
                if (server.id === selectedServerId) return;
                void switchServer(server.id);
              }}
            >
              {server.name[0]?.toUpperCase()}
            </button>
            <span className="serverTooltip" role="tooltip">
              {server.name}
            </span>
          </div>
        ))}
        {session.user.role !== "demo" && (
          <div className="serverButtonWrap">
            <button
              className="workspaceButton"
              aria-label="Create server"
              onClick={() => setForm("server")}
            >
              +
            </button>
            <span className="serverTooltip" role="tooltip">
              Create a server
            </span>
          </div>
        )}
      </aside>
      <aside className="channelSidebar">
        <header className="workspaceName">
          <strong>
            {servers.find((server) => server.id === selectedServerId)?.name ??
              "LC"}
          </strong>
          {isSelectedServerOwner && selectedServerId && (
            <div
              className={`accountMenu serverActions ${serverSettingsOpen ? "open" : ""}`}
              ref={serverSettingsMenu}
            >
              <button
                className="accountMenuTrigger"
                aria-expanded={serverSettingsOpen}
                onClick={() => setServerSettingsOpen((current) => !current)}
              >
                Server settings
              </button>
              {serverSettingsOpen && (
                <div className="accountMenuDropdown">
                  <button
                    onClick={() => {
                      const server = servers.find(
                        (candidate) => candidate.id === selectedServerId,
                      );
                      if (server)
                        setRenameTarget({ kind: "server", ...server });
                      setServerSettingsOpen(false);
                    }}
                  >
                    Rename server
                  </button>
                  <button
                    onClick={() => {
                      setForm("channel");
                      setServerSettingsOpen(false);
                    }}
                  >
                    Create channel
                  </button>
                  <button
                    onClick={() => {
                      setServerFriendSearch("");
                      setSelectedServerFriendIds([]);
                      setAddFriendsOpen(true);
                      void loadFriends();
                    }}
                  >
                    Add friends to server
                  </button>
                  <button
                    className="danger"
                    onClick={() => setDeleteServerOpen(true)}
                  >
                    Delete server
                  </button>
                </div>
              )}
            </div>
          )}
        </header>
        <nav>
          <p className="sectionLabel">TEXT CHANNELS</p>
          {channels
            .filter((channel) => channel.type === "text")
            .map((channel) => (
              <div className="channelRow" key={channel.id}>
                <button
                  className={`channel ${channel.id === selectedChannelId ? "active" : ""}`}
                  title={channel.name}
                  onClick={() => {
                    lastTextChannelId.current = channel.id;
                    setCallViewOpen(false);
                    setReplyingTo(null);
                    setMessageMenu(null);
                    setSelectedChannelId(channel.id);
                  }}
                >
                  {channel.name}
                </button>
                {isSelectedServerOwner && (
                  <button
                    className="renameChannel"
                    aria-label={`Rename ${channel.name}`}
                    title="Rename channel"
                    onClick={() =>
                      setRenameTarget({ kind: "channel", ...channel })
                    }
                  >
                    ✎
                  </button>
                )}
              </div>
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
                  <span className="channelIcon" aria-hidden="true">
                    {channel.type === "voice_group" ? "◉" : "\u{1F50A}"}
                  </span>
                  <span className="channelName" title={channel.name}>
                    {channel.name}
                  </span>
                  {channel.id === activeVoiceChannelId && (
                    <ConnectionDiagnostics
                      ping={directPing ?? channelPing[channel.id]}
                      diagnostics={callDiagnostics}
                    />
                  )}
                </button>
                {isSelectedServerOwner && (
                  <button
                    className="renameChannel"
                    aria-label={`Rename ${channel.name}`}
                    title="Rename channel"
                    onClick={() =>
                      setRenameTarget({ kind: "channel", ...channel })
                    }
                  >
                    ✎
                  </button>
                )}
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
                        className={`voiceParticipant ${channel.id === activeVoiceChannelId && participant.speaking ? "speaking" : ""}`}
                        key={
                          participant.userId ?? `${participant.name}-${index}`
                        }
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
                        {isSelectedServerOwner &&
                          participant.userId &&
                          participant.userId !== session.user.id && (
                            <button
                              type="button"
                              className="voiceKick"
                              title={`Disconnect ${participant.name} from voice`}
                              onClick={() =>
                                void kickVoiceParticipant(
                                  participant.userId!,
                                  channel.id,
                                )
                              }
                            >
                              Kick
                            </button>
                          )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </nav>
        {profilePanel}
      </aside>
      <section
        className={`room ${selectedChannel?.type === "text" ? "textOnly" : ""}`}
      >
        <header className="roomHeader">
          {panelControls}
          <strong>
            {displayedChannel
              ? `${displayedChannel.type === "text" ? "" : displayedChannel.type === "voice_group" ? "◉ " : "\u{1F50A} "}${displayedChannel.name}`
              : "Select a channel"}
          </strong>
          <div
            className={`accountMenu ${demoMenuOpen ? "open" : ""} ${session.user.role !== "owner" ? "ownerOnlyHidden" : ""}`}
            ref={demoMenu}
          >
            <button
              className="accountMenuTrigger"
              aria-expanded={demoMenuOpen}
              onClick={() => setDemoMenuOpen((current) => !current)}
            >
              Manage demo accounts
              <span aria-hidden="true">⌄</span>
            </button>
            {demoMenuOpen && (
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
                  muted
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
              <div className="callDiagnosticsControl">
                <ConnectionDiagnostics
                  ping={directPing}
                  diagnostics={callDiagnostics}
                />
              </div>
            </div>
            <div className="controls voiceDock">
              {audioPlaybackBlocked && (
                <button type="button" onClick={() => void playRemoteAudio()}>
                  Enable sound
                </button>
              )}
              {joined ? (
                <>
                  <DeviceMenu
                    kind="microphone"
                    disabled={muted}
                    devices={microphones}
                    selectedId={microphoneId}
                    onAction={toggleAudio}
                    onRestart={() => void changeActiveMicrophone(microphoneId)}
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
            onDiagnosticsChange={setCallDiagnostics}
            onLeave={returnToPreviousTextChannel}
            onError={setErrorMessage}
          />
        )}
        {selectedChannel?.type === "text" && !callViewOpen && (
          <section className="chat">
            <div className="chatLog">
              {nextMessageCursor && (
                <button
                  type="button"
                  onClick={() => void loadMoreMessages()}
                  disabled={loadingMoreMessages}
                >
                  {loadingMoreMessages ? "Loading…" : "Load 50 older messages"}
                </button>
              )}
              {messages.length === 0 && (
                <p className="empty">
                  {selectedChannelId
                    ? "This channel has no messages yet."
                    : "Create or select a channel to begin."}
                </p>
              )}
              {messages.map((message) => (
                <article
                  className={message.deleted ? "deletedMessage" : undefined}
                  key={message.id}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMessageMenu({
                      message,
                      x: Math.min(event.clientX, window.innerWidth - 190),
                      y: Math.min(event.clientY, window.innerHeight - 110),
                    });
                  }}
                >
                  {message.replyTo && (
                    <div className="replyPreview">
                      <strong>{message.replyTo.author}</strong>
                      <span>{message.replyTo.text}</span>
                    </div>
                  )}
                  <b>{message.author}</b>
                  <time>{message.time}</time>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            <form onSubmit={submit}>
              <div className="messageComposer">
                {replyingTo && (
                  <div className="replyingTo">
                    <span>
                      Replying to <strong>{replyingTo.author}</strong>
                    </span>
                    <button
                      type="button"
                      aria-label="Cancel reply"
                      onClick={() => setReplyingTo(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
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
              </div>
              <button disabled={!selectedChannelId}>Send</button>
            </form>
          </section>
        )}
      </section>
      <aside className="memberSidebar">
        <header className="memberSidebarHeader">
          {closeUserList}
          <strong>ALL USERS — {members.length}</strong>
        </header>
        <input
          className="memberSearch"
          type="search"
          value={memberSearch}
          onChange={(event) => setMemberSearch(event.target.value)}
          placeholder="Search users"
          aria-label="Search users"
        />
        <div className="memberScroll">
          <p className="sectionLabel">ONLINE — {onlineMembers.length}</p>
          {onlineMembers.map((member) => (
            <div
              className="member online"
              key={member.id}
              onContextMenu={(event) => {
                if (!isSelectedServerOwner || member.role === "owner") return;
                event.preventDefault();
                setMemberMenu({
                  member,
                  x: Math.min(event.clientX, window.innerWidth - 190),
                  y: Math.min(event.clientY, window.innerHeight - 70),
                });
              }}
            >
              <span className={`avatar role-${member.role}`}>
                {member.name[0]?.toUpperCase()}
              </span>
              <span className="memberIdentity">
                <strong title={member.name}>{member.name}</strong>
                <small>{member.role}</small>
              </span>
            </div>
          ))}
          <p className="sectionLabel">OFFLINE — {offlineMembers.length}</p>
          {offlineMembers.map((member) => (
            <div
              className="member offline"
              key={member.id}
              onContextMenu={(event) => {
                if (!isSelectedServerOwner || member.role === "owner") return;
                event.preventDefault();
                setMemberMenu({
                  member,
                  x: Math.min(event.clientX, window.innerWidth - 190),
                  y: Math.min(event.clientY, window.innerHeight - 70),
                });
              }}
            >
              <span className={`avatar role-${member.role}`}>
                {member.name[0]?.toUpperCase()}
              </span>
              <span className="memberIdentity">
                <strong title={member.name}>{member.name}</strong>
                <small>{member.role}</small>
              </span>
            </div>
          ))}
        </div>
        {legalLinks}
      </aside>
      {legalOverlay}
      {memberMenu && (
        <div
          className="messageContextMenu"
          ref={memberContextMenu}
          role="menu"
          style={{ left: memberMenu.x, top: memberMenu.y }}
        >
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              setKickCandidate(memberMenu.member);
              setMemberMenu(null);
            }}
          >
            Kick from server
          </button>
        </div>
      )}
      {messageMenu && (
        <div
          className="messageContextMenu"
          ref={messageContextMenu}
          role="menu"
          style={{ left: messageMenu.x, top: messageMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setReplyingTo(messageMenu.message);
              setMessageMenu(null);
            }}
          >
            Reply
          </button>
          {messageMenu.message.authorId === session.user.id &&
            !messageMenu.message.deleted && (
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() =>
                  requestMessageDeletion(
                    messageMenu.message.id,
                    messageMenu.message.text,
                  )
                }
              >
                Delete message
              </button>
            )}
        </div>
      )}
      {addFriendsOpen && (
        <div
          className="modalBackdrop nestedModalBackdrop"
          onMouseDown={() => {
            setAddFriendsOpen(false);
            setServerSettingsOpen(false);
          }}
        >
          <section
            className="modalCard addFriendsModal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>Add friends to server</h2>
            <p>
              Select one or more friends. Friends already in this server are
              hidden.
            </p>
            <input
              autoFocus
              value={serverFriendSearch}
              onChange={(event) => setServerFriendSearch(event.target.value)}
              placeholder="Search friends"
            />
            <div className="friendPickerList">
              {availableServerFriends.map((friend) => (
                <label className="friendPickerRow" key={friend.id}>
                  <input
                    type="checkbox"
                    checked={selectedServerFriendIds.includes(friend.id)}
                    onChange={(event) =>
                      setSelectedServerFriendIds((current) =>
                        event.target.checked
                          ? [...current, friend.id]
                          : current.filter((id) => id !== friend.id),
                      )
                    }
                  />
                  <span>
                    <b>{friend.name}</b>
                    <small>{formatUserHandle(friend.handle)}</small>
                  </span>
                </label>
              ))}
              {availableServerFriends.length === 0 && (
                <p className="emptyState">
                  No available friends match this search.
                </p>
              )}
            </div>
            <div className="modalActions">
              <button
                type="button"
                onClick={() => {
                  setAddFriendsOpen(false);
                  setServerSettingsOpen(false);
                }}
              >
                Close
              </button>
              <button
                className="primary"
                type="button"
                disabled={selectedServerFriendIds.length === 0}
                onClick={() => void addSelectedFriendsToServer()}
              >
                Add selected ({selectedServerFriendIds.length})
              </button>
            </div>
          </section>
        </div>
      )}
      {deleteServerOpen && (
        <div className="modalBackdrop deletionConfirmationBackdrop">
          <section className="modalCard deletionConfirmationModal">
            <h2>Delete server?</h2>
            <p>
              This permanently deletes{" "}
              <b>
                {servers.find((server) => server.id === selectedServerId)?.name}
              </b>
              , including its channels and messages.
            </p>
            <div className="modalActions">
              <button
                type="button"
                onClick={() => {
                  setDeleteServerOpen(false);
                  setServerSettingsOpen(false);
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => void deleteServer()}
              >
                Delete server
              </button>
            </div>
          </section>
        </div>
      )}
      {renameTarget && (
        <div
          className="modalBackdrop"
          onMouseDown={() => setRenameTarget(null)}
        >
          <form
            className="modalCard renameModal"
            onSubmit={saveRename}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>
              Rename{" "}
              {["user", "demo"].includes(renameTarget.kind)
                ? "username"
                : renameTarget.kind}
            </h2>
            <label>
              Name
              <input
                autoFocus
                maxLength={60}
                required
                value={renameTarget.name}
                onChange={(event) =>
                  setRenameTarget((current) =>
                    current
                      ? { ...current, name: event.target.value }
                      : current,
                  )
                }
              />
            </label>
            <div className="modalActions">
              <button type="button" onClick={() => setRenameTarget(null)}>
                Cancel
              </button>
              <button className="primary" type="submit">
                Save name
              </button>
            </div>
          </form>
        </div>
      )}
      {form && (
        <div className="modalBackdrop" onMouseDown={closeCurrentForm}>
          <form
            className={`modalCard ${form === "manage" ? "manageDemoModal" : ""}`}
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
                      : form === "messages"
                        ? "Account messages"
                        : "Manage demo accounts"}
            </h2>
            {form !== "manage" && form !== "media" && form !== "messages" && (
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
                        Expires {formatLocalDateTime(account.expiresAt)}
                      </small>
                    )}
                    {demoInviteLinks[account.id] && (
                      <p className="inviteResult">
                        {demoInviteLinks[account.id]}
                      </p>
                    )}
                    <div className="demoAccountActions">
                      {(account.status === "active" ||
                        account.status === "pending") &&
                        account.servers.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setExtendingDemoAccount(account);
                              setDemoExtensionHours("4");
                            }}
                          >
                            Extend access
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() =>
                          setRenameTarget({
                            kind: "demo",
                            id: account.id,
                            name: account.name,
                          })
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => void openDemoServerAssignments(account)}
                      >
                        Servers
                      </button>
                      <button
                        type="button"
                        onClick={() => setRegenerateInviteCandidate(account)}
                      >
                        New invite
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void openAccountMessages(
                            account.id,
                            account.name,
                            true,
                          )
                        }
                      >
                        Messages
                      </button>
                      {!["revoked", "expired"].includes(account.status) && (
                        <button
                          className="danger"
                          type="button"
                          onClick={() => setRevokeCandidateId(account.id)}
                        >
                          Revoke access
                        </button>
                      )}
                    </div>
                    <button
                      className="deleteDemoTrash"
                      type="button"
                      title="Delete account"
                      aria-label={`Delete ${account.name}`}
                      onClick={() => {
                        setDeleteDemoCandidate(account);
                        setDeleteDemoMessages(false);
                      }}
                    >
                      <span aria-hidden="true">🗑</span>
                    </button>
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
            {form === "messages" && (
              <div className="accountMessageList">
                <p>
                  Messages written by <strong>{messageAccount.name}</strong>
                </p>
                {accountMessages.length === 0 && (
                  <p className="empty">No messages found.</p>
                )}
                {accountMessages.map((message) => (
                  <article key={message.id}>
                    <div className="managedMessageHeader">
                      <small>
                        {message.serverName} / #{message.channelName} ·{" "}
                        {formatLocalDateTime(message.createdAt)}
                      </small>
                      <button
                        className="messageDeleteButton"
                        type="button"
                        onClick={() =>
                          requestMessageDeletion(message.id, message.text)
                        }
                      >
                        Delete
                      </button>
                    </div>
                    <p>{message.text}</p>
                  </article>
                ))}
                {accountMessages.length > 0 &&
                  (deleteMessagesPending ? (
                    <div className="revokeActions">
                      <button
                        type="button"
                        onClick={() => setDeleteMessagesPending(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => void deleteAccountMessages()}
                      >
                        Confirm delete all
                      </button>
                    </div>
                  ) : (
                    <button
                      className="danger"
                      type="button"
                      onClick={() => setDeleteMessagesPending(true)}
                    >
                      Delete all messages
                    </button>
                  ))}
              </div>
            )}
            <div className="modalActions">
              <button type="button" onClick={closeCurrentForm}>
                {form === "manage" || form === "media" || form === "messages"
                  ? form === "messages" && returnToDemoManager
                    ? "Back"
                    : "Close"
                  : "Cancel"}
              </button>
              {form !== "manage" && form !== "media" && form !== "messages" && (
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
      {editingDemoAccount && (
        <div className="modalBackdrop nestedModalBackdrop">
          <section
            className="modalCard serverAssignmentModal"
            role="dialog"
            aria-modal="true"
          >
            <h2>Server access for {editingDemoAccount.name}</h2>
            <p>
              Select at least one server. Saving applies the latest server list
              and refreshes the demo user’s page.
            </p>
            <div className="serverAssignmentList">
              {servers.map((server) => (
                <label key={server.id}>
                  <input
                    type="checkbox"
                    checked={editingDemoServers.includes(server.id)}
                    onChange={(event) =>
                      setEditingDemoServers((current) =>
                        event.target.checked
                          ? [...current, server.id]
                          : current.filter((id) => id !== server.id),
                      )
                    }
                  />
                  <span>{server.name}</span>
                </label>
              ))}
            </div>
            <div className="modalActions">
              <button type="button" onClick={() => setEditingDemoAccount(null)}>
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                disabled={editingDemoServers.length === 0}
                onClick={() => void saveDemoServers(editingDemoAccount)}
              >
                Save access
              </button>
            </div>
          </section>
        </div>
      )}
      {kickCandidate && (
        <div className="modalBackdrop nestedModalBackdrop">
          <section
            className="modalCard deletionConfirmation"
            role="dialog"
            aria-modal="true"
          >
            <h2>Kick {kickCandidate.name}?</h2>
            <p>
              They will immediately lose access to this server and be
              disconnected from its direct and group voice channels.
            </p>
            <div className="modalActions">
              <button type="button" onClick={() => setKickCandidate(null)}>
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => void kickMember(kickCandidate.id)}
              >
                Kick from server
              </button>
            </div>
          </section>
        </div>
      )}
      {revokeCandidateId && (
        <div
          className="modalBackdrop nestedModalBackdrop"
          onMouseDown={() => setRevokeCandidateId("")}
        >
          <section
            className="modalCard confirmationModal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>Revoke access?</h2>
            <p>
              This signs the demo account out and removes it from every server.
              Its existing messages are kept.
            </p>
            <div className="modalActions">
              <button type="button" onClick={() => setRevokeCandidateId("")}>
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => void revokeDemoAccount(revokeCandidateId)}
              >
                Revoke access
              </button>
            </div>
          </section>
        </div>
      )}
      {regenerateInviteCandidate && (
        <div className="modalBackdrop nestedModalBackdrop">
          <section
            className="modalCard deletionConfirmation"
            role="dialog"
            aria-modal="true"
          >
            <h2>Generate a new invitation?</h2>
            <p>
              The existing invitation link for {regenerateInviteCandidate.name}{" "}
              will stop working immediately.
            </p>
            <div className="modalActions">
              <button
                type="button"
                onClick={() => setRegenerateInviteCandidate(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="button"
                onClick={() =>
                  void regenerateDemoInvite(regenerateInviteCandidate)
                }
              >
                Generate new link
              </button>
            </div>
          </section>
        </div>
      )}
      {extendingDemoAccount && (
        <div
          className="modalBackdrop nestedModalBackdrop"
          onMouseDown={() => {
            if (!extendingDemoAccess) setExtendingDemoAccount(null);
          }}
        >
          <form
            className="modalCard demoExtensionModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extend-demo-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => void extendDemoAccess(event)}
          >
            <h2 id="extend-demo-title">
              Extend access for {extendingDemoAccount.name}
            </h2>
            <p>
              Add time to the current expiry without interrupting their login or
              changing their invitation.
            </p>
            {extendingDemoAccount.expiresAt && (
              <p>
                Current expiry:{" "}
                {formatLocalDateTime(extendingDemoAccount.expiresAt)}
              </p>
            )}
            <label>
              Additional access (hours)
              <input
                autoFocus
                type="number"
                min={1}
                max={720}
                step={1}
                required
                value={demoExtensionHours}
                onChange={(event) => setDemoExtensionHours(event.target.value)}
              />
            </label>
            <small>Choose 1–720 hours (up to 30 additional days).</small>
            <div className="modalActions">
              <button
                type="button"
                disabled={extendingDemoAccess}
                onClick={() => setExtendingDemoAccount(null)}
              >
                Cancel
              </button>
              <button
                className="primary"
                type="submit"
                disabled={extendingDemoAccess}
              >
                {extendingDemoAccess ? "Extending…" : "Extend access"}
              </button>
            </div>
          </form>
        </div>
      )}
      {directDeletionDialog}
      {deleteMessageCandidate && !deleteMessageCandidate.conversationUserId && (
        <div
          className="modalBackdrop deletionConfirmationBackdrop"
          onMouseDown={() => {
            setDeleteMessageCandidate(null);
            setPermanentMessageDeletion(false);
          }}
        >
          <section
            className="modalCard deletionConfirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-message-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="delete-message-title">Delete message?</h2>
            <p>
              By default, LC erases the message content but keeps a
              <em> Deleted message </em>
              placeholder so existing replies still make sense.
            </p>
            <blockquote>{deleteMessageCandidate.preview}</blockquote>
            <label className="permanentDeleteOption">
              <input
                type="checkbox"
                checked={permanentMessageDeletion}
                onChange={(event) =>
                  setPermanentMessageDeletion(event.target.checked)
                }
              />
              <span>
                Delete completely
                <small>
                  Permanently removes the database row and disconnects replies
                  from this message. This cannot be undone.
                </small>
              </span>
            </label>
            <div className="modalActions">
              <button
                type="button"
                onClick={() => {
                  setDeleteMessageCandidate(null);
                  setPermanentMessageDeletion(false);
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => void deleteMessage()}
              >
                {permanentMessageDeletion
                  ? "Delete permanently"
                  : "Delete message"}
              </button>
            </div>
          </section>
        </div>
      )}
      {deleteDemoCandidate && (
        <div className="modalBackdrop deletionConfirmationBackdrop">
          <section
            className="modalCard deletionConfirmation"
            role="dialog"
            aria-modal="true"
          >
            <h2>Delete {deleteDemoCandidate.name}?</h2>
            <p>
              The account will immediately lose all server, signaling, and voice
              access.
            </p>
            <label className="permanentDeleteOption">
              <input
                type="checkbox"
                checked={deleteDemoMessages}
                onChange={(event) =>
                  setDeleteDemoMessages(event.target.checked)
                }
              />
              <span>
                Delete all messages
                <small>
                  When disabled, messages remain under “Deleted user”. When
                  enabled, every message is permanently removed.
                </small>
              </span>
            </label>
            <div className="modalActions">
              <button
                type="button"
                onClick={() => setDeleteDemoCandidate(null)}
              >
                Cancel
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => void deleteDemoAccount()}
              >
                Delete account
              </button>
            </div>
          </section>
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
      {noticeMessage && (
        <div className="noticeToast" role="status">
          <span>{noticeMessage}</span>
          <button
            aria-label="Dismiss confirmation"
            onClick={() => setNoticeMessage("")}
          >
            ×
          </button>
        </div>
      )}
      {incomingCallOverlay}
    </main>
  );
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) {
    throw new Error(`Server returned an empty response (${response.status}).`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `Server returned an invalid response (${response.status}).`,
    );
  }
}

function apiErrorMessage(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return "The server could not complete the request.";
}

function time() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toChatMessage(message: {
  id: string;
  authorId: string;
  author: string;
  text: string;
  createdAt?: string | Date;
  deleted?: boolean;
  deletedAt?: string | Date | null;
  replyTo?: { id: string; text: string; author: string } | null;
  kind?: "message" | "call";
  callDurationSeconds?: number | null;
}): ChatMessage {
  return {
    id: message.id,
    authorId: message.authorId,
    author: message.author,
    text:
      message.deleted || message.deletedAt ? "Deleted message" : message.text,
    deleted: Boolean(message.deleted || message.deletedAt),
    replyTo: message.replyTo ?? null,
    kind: message.kind ?? "message",
    callDurationSeconds: message.callDurationSeconds ?? null,
    time: message.createdAt
      ? new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : time(),
  };
}

let cachedSignalingToken = "";
let signalingTokenExpiresAt = 0;
let signalingTokenRequest: Promise<string> | null = null;

function invalidateSignalingToken() {
  cachedSignalingToken = "";
  signalingTokenExpiresAt = 0;
}

async function getSignalingToken() {
  if (cachedSignalingToken && Date.now() < signalingTokenExpiresAt) {
    return cachedSignalingToken;
  }
  signalingTokenRequest ??= fetch("/api/signaling-token", { method: "POST" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Could not create signaling token");
      const { token } = (await response.json()) as { token?: string };
      if (!token) throw new Error("Signaling token was missing");
      cachedSignalingToken = token;
      signalingTokenExpiresAt = Date.now() + 45_000;
      return token;
    })
    .finally(() => {
      signalingTokenRequest = null;
    });
  return signalingTokenRequest;
}

async function openSignalingSocket() {
  const token = await getSignalingToken();
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

function audioConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: { ideal: 1 },
    sampleRate: { ideal: 48_000 },
    ...microphoneProcessing(),
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

async function preferResilientAudio(sender: RTCRtpSender) {
  const parameters = sender.getParameters();
  parameters.encodings ??= [{}];
  for (const encoding of parameters.encodings) {
    encoding.maxBitrate = 64_000;
  }
  try {
    await sender.setParameters(parameters);
  } catch {
    // The SDP preferences below still apply in browsers that reject this.
  }
}

function preferOpus(peer: RTCPeerConnection, sender: RTCRtpSender) {
  const capabilities = RTCRtpReceiver.getCapabilities?.("audio");
  const transceiver = peer
    .getTransceivers()
    .find((candidate) => candidate.sender === sender);
  if (!capabilities || !transceiver?.setCodecPreferences) return;
  const codecs = [...capabilities.codecs].sort((left, right) => {
    const leftOpus = left.mimeType.toLowerCase() === "audio/opus";
    const rightOpus = right.mimeType.toLowerCase() === "audio/opus";
    return Number(rightOpus) - Number(leftOpus);
  });
  try {
    transceiver.setCodecPreferences(codecs);
  } catch {
    // Codec preference is advisory and is not supported by every browser.
  }
}

function preferStableAudio(receiver: RTCRtpReceiver) {
  // Keep the browser's adaptive jitter buffer. A fixed 200 ms target added
  // avoidable latency and did not improve this connection's measured loss.
  void receiver;
}

function monitorPeerVideo(
  peer: RTCPeerConnection,
  onChange: (stats: string) => void,
  onPing: (ping: number) => void,
  onDiagnostics: (diagnostics: CallDiagnostics) => void,
) {
  const previousBytes = new Map<string, { bytes: number; timestamp: number }>();
  const previousAudioBytes = new Map<
    string,
    { bytes: number; timestamp: number }
  >();
  let lastDiagnostics: CallDiagnostics | null = null;
  const audioWindow = createAudioWindowStats();
  const interval = window.setInterval(async () => {
    try {
      const report = await peer.getStats();
      const values: string[] = [];
      let ping = "";
      let selectedPair: (RTCStats & Record<string, unknown>) | undefined;
      let selectedPairId = "";
      let inboundAudio: (RTCStats & Record<string, unknown>) | undefined;
      let outboundAudio: (RTCStats & Record<string, unknown>) | undefined;
      report.forEach((raw) => {
        const stat = raw as RTCStats &
          Record<string, unknown> & {
            kind?: string;
            mediaType?: string;
            bytesSent?: number;
            bytesReceived?: number;
            framesPerSecond?: number;
            currentRoundTripTime?: number;
            state?: string;
          };
        if (stat.type === "transport" && stat.selectedCandidatePairId) {
          selectedPairId = String(stat.selectedCandidatePairId);
        }
        if (
          stat.type === "candidate-pair" &&
          stat.state === "succeeded" &&
          (stat.nominated === true || selectedPair === undefined)
        ) {
          selectedPair = stat;
          if (stat.currentRoundTripTime !== undefined) {
            const milliseconds = Math.round(stat.currentRoundTripTime * 1000);
            ping = `${milliseconds} ms ping`;
            onPing(milliseconds);
          }
        }
        if (
          stat.type === "inbound-rtp" &&
          (stat.kind ?? stat.mediaType) === "audio"
        ) {
          inboundAudio = stat;
        }
        if (
          stat.type === "outbound-rtp" &&
          (stat.kind ?? stat.mediaType) === "audio"
        ) {
          outboundAudio = stat;
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
      if (selectedPairId) {
        const transportPair = report.get(selectedPairId) as
          (RTCStats & Record<string, unknown>) | undefined;
        if (transportPair) selectedPair = transportPair;
      }
      const localCandidate = selectedPair?.localCandidateId
        ? (report.get(String(selectedPair.localCandidateId)) as
            (RTCStats & Record<string, unknown>) | undefined)
        : undefined;
      const remoteCandidate = selectedPair?.remoteCandidateId
        ? (report.get(String(selectedPair.remoteCandidateId)) as
            (RTCStats & Record<string, unknown>) | undefined)
        : undefined;
      const codec = inboundAudio?.codecId
        ? (report.get(String(inboundAudio.codecId)) as
            (RTCStats & Record<string, unknown>) | undefined)
        : undefined;
      const received = Number(inboundAudio?.packetsReceived ?? 0);
      const lost = Number(inboundAudio?.packetsLost ?? 0);
      const total = received + Math.max(0, lost);
      const totalSamples = Number(inboundAudio?.totalSamplesReceived ?? 0);
      const concealedSamples = Number(inboundAudio?.concealedSamples ?? 0);
      const audioRates = [inboundAudio, outboundAudio]
        .map((stat, index) => {
          if (!stat) return "";
          const bytes = Number(stat.bytesReceived ?? stat.bytesSent ?? 0);
          const previous = previousAudioBytes.get(stat.id);
          previousAudioBytes.set(stat.id, { bytes, timestamp: stat.timestamp });
          if (!previous) return "";
          const seconds = (stat.timestamp - previous.timestamp) / 1000;
          if (seconds <= 0) return "";
          const kbps = Math.round(
            ((bytes - previous.bytes) * 8) / seconds / 1000,
          );
          return `${index === 0 ? "down" : "up"} ${kbps} kbps`;
        })
        .filter(Boolean)
        .join(" / ");
      const nextDiagnostics: CallDiagnostics = {
        receivedAudio: inboundAudio
          ? `${received} packets / ${Number(inboundAudio.bytesReceived ?? 0)} bytes`
          : "No incoming audio packets yet",
        recentAudio: audioWindow({
          received,
          lost,
          concealed: concealedSamples,
          samples: totalSamples,
        }),
        status: peer.connectionState,
        route: localCandidate
          ? `${String(localCandidate.candidateType ?? "unknown")} → ${String(remoteCandidate?.candidateType ?? "unknown")}`
          : (lastDiagnostics?.route ?? "unknown → unknown"),
        protocol: localCandidate?.protocol
          ? String(localCandidate.protocol).toUpperCase()
          : (lastDiagnostics?.protocol ?? "unknown"),
        codec: codec?.mimeType
          ? String(codec.mimeType).replace("audio/", "")
          : (lastDiagnostics?.codec ?? "unknown"),
        jitterMs:
          inboundAudio?.jitter === undefined
            ? null
            : Math.round(Number(inboundAudio.jitter) * 1000),
        packetLoss: total
          ? `${((Math.max(0, lost) / total) * 100).toFixed(1)}%`
          : "0%",
        concealedAudio: totalSamples
          ? `${((concealedSamples / totalSamples) * 100).toFixed(1)}%`
          : "0%",
        audioBitrate:
          audioRates || lastDiagnostics?.audioBitrate || "measuring…",
      };
      lastDiagnostics = nextDiagnostics;
      onDiagnostics(nextDiagnostics);
      onChange([...values, ping].filter(Boolean).join(" · "));
    } catch {
      onChange("");
      if (lastDiagnostics) {
        onDiagnostics({
          ...lastDiagnostics,
          status: `${peer.connectionState} (stats delayed)`,
        });
      } else {
        onDiagnostics({
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

function DiagnosticsIndicator({
  diagnostics,
}: {
  diagnostics: CallDiagnostics | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="diagnosticsIndicator"
      tabIndex={0}
      role="button"
      aria-expanded={open}
      aria-label="Call diagnostics"
      onClick={(event) => {
        event.stopPropagation();
        setOpen((current) => !current);
      }}
      onBlur={() => setOpen(false)}
    >
      i
      <span className={`diagnosticsTooltip ${open ? "open" : ""}`}>
        <strong>Call diagnostics</strong>
        {diagnostics ? (
          <>
            <span>Route: {diagnostics.route}</span>
            <span>Connection: {diagnostics.status}</span>
            {diagnostics.connectivity && (
              <span>{diagnostics.connectivity}</span>
            )}
            {diagnostics.negotiation && <span>{diagnostics.negotiation}</span>}
            {diagnostics.playback && (
              <span>Playback: {diagnostics.playback}</span>
            )}
            {diagnostics.receivedAudio && (
              <span>Received: {diagnostics.receivedAudio}</span>
            )}
            {diagnostics.recentAudio && (
              <span>Latest sample: {diagnostics.recentAudio}</span>
            )}
            <span>Protocol: {diagnostics.protocol}</span>
            <span>Codec: {diagnostics.codec}</span>
            {diagnostics.microphone && (
              <span>Microphone: {diagnostics.microphone}</span>
            )}
            <span>Audio: {diagnostics.audioBitrate}</span>
            <span>Jitter: {diagnostics.jitterMs ?? "—"} ms</span>
            <span>Packet loss: {diagnostics.packetLoss}</span>
            <span>Concealed audio: {diagnostics.concealedAudio}</span>
          </>
        ) : (
          <span>Waiting for connection statistics…</span>
        )}
      </span>
    </span>
  );
}

function ConnectionDiagnostics({
  ping,
  diagnostics,
}: {
  ping: number | null | undefined;
  diagnostics: CallDiagnostics | null;
}) {
  return (
    <span className="connectionIndicators">
      {ping !== null && ping !== undefined && <PingIndicator ping={ping} />}
      <DiagnosticsIndicator diagnostics={diagnostics} />
    </span>
  );
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
