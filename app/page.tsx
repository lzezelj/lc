"use client";

import {
  FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { signOut, useSession } from "next-auth/react";
import { playVoiceSound, prepareVoiceSounds } from "./call-sounds";
import { DeviceMenu, MediaDeviceOption, MediaIcon } from "./device-menu";
import { DeviceSelection } from "./device-selection";
import { GroupCall } from "./group-call";
import { WorkspaceShell } from "./workspace-shell";
import {
  HideTileButton,
  HiddenTilesMenu,
  SelfViewButton,
} from "./call-tile-controls";
import { useCallAudio } from "./call-media";
import { MediaTests } from "./media-tests";
import {
  captureThresholdMicrophone,
  readMicrophoneVolume,
  setMicrophoneDeafened,
} from "./microphone-gate";
import { AudioDeviceOptions } from "./audio-device-options";
import { applyCallOutput, readOutputVolume } from "./audio-output";
import {
  SettingsIcon,
  SettingsModal,
  SettingsNameForm,
} from "./settings-modal";
import { UserProfile, type ProfileUser } from "./user-profile";
import { ChannelManager } from "./channel-manager";
import { groupMessagesByServer } from "./message-groups";
import { MessageDeleteAction } from "./message-delete-action";
import { ChatHistory } from "./chat-history";
import { MessageHeader } from "./message-header";
import {
  readWorkspaceLocation,
  saveWorkspaceLocation,
  restoredTextChannel,
  type WorkspaceLocation,
} from "./workspace-location";
import { SidebarResizer } from "./sidebar-resizer";
import {
  UserStatusMenu,
  isUserStatus,
  readUserStatus,
  statusLabels,
  type UserStatus,
} from "./user-status-menu";
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

type MessageCursor = { beforeCreatedAt: string; beforeId: string };
type HistoryPage = {
  messages: Parameters<typeof toChatMessage>[0][];
  nextCursor: MessageCursor | null;
};
function mergeChatMessages(incoming: ChatMessage[], current: ChatMessage[]) {
  return [
    ...new Map(
      [...incoming, ...current].map((message) => [message.id, message]),
    ).values(),
  ];
}

type Server = { id: string; name: string; role?: "owner" | "member" };
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
  serverId: string;
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
  channelId?: string;
  type: string;
  serverId?: string;
  userIds?: string[];
  statuses?: Record<string, UserStatus>;
  status?: UserStatus;
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
  const sessionState = useSession();
  const session = sessionState.data;
  const sessionStatus: string = sessionState.status;
  const updateSession = sessionState.update;
  // Auth.js retains the current session while update() refreshes it. Keep the
  // workspace and presence mounted through that temporary loading state.
  const authStatus =
    session?.user.id && sessionStatus === "loading"
      ? "authenticated"
      : sessionStatus;
  const [servers, setServers] = useState<Server[]>([]);
  const [friendsView, setFriendsView] = useState(true);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [friendResults, setFriendResults] = useState<Friend[]>([]);
  const [friendTab, setFriendTab] = useState<"online" | "offline" | "pending">(
    "online",
  );
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const [directMessages, setDirectMessages] = useState<ChatMessage[]>([]);
  const [directMessageCursor, setDirectMessageCursor] =
    useState<MessageCursor | null>(null);
  const [loadingOlderDirect, setLoadingOlderDirect] = useState(false);
  const [directHistoryLoaded, setDirectHistoryLoaded] = useState("");
  const directHistoryGeneration = useRef(0);
  const [channelHistoryLoaded, setChannelHistoryLoaded] = useState("");
  const channelHistoryGeneration = useRef(0);
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
  const [navigationReady, setNavigationReady] = useState(false);
  const pendingLocation = useRef<WorkspaceLocation | null>(null);
  const locationUser = useRef("");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [userStatus, setUserStatus] = useState<UserStatus>(readUserStatus);
  const [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>(
    {},
  );
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [form, setForm] = useState<
    "server" | "channel" | "account" | "manage" | "messages" | null
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
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = Number(localStorage.getItem("lc.sidebarWidth"));
    return Number.isFinite(saved) && saved >= 240 && saved <= 480
      ? saved
      : null;
  });
  const [userListToggled, setUserListToggled] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [userSettingsSection, setUserSettingsSection] = useState("account");
  const [serverSettingsSection, setServerSettingsSection] =
    useState("overview");
  const [profileUser, setProfileUser] = useState<ProfileUser | null>(null);
  const [serverContext, setServerContext] = useState<{
    server: Server;
    x: number;
    y: number;
  } | null>(null);
  const serverContextRef = useRef<HTMLDivElement>(null);
  const [channelContext, setChannelContext] = useState<{
    channel: Channel;
    x: number;
    y: number;
  } | null>(null);
  const channelContextRef = useRef<HTMLDivElement>(null);
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
    alreadyDeleted?: boolean;
  } | null>(null);
  const [permanentMessageDeletion, setPermanentMessageDeletion] =
    useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("Not connected");
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [mediaNotice, setMediaNotice] = useState("");
  const [microphoneMuted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const muted = microphoneMuted || deafened;
  const effectiveMutedRef = useRef(muted);
  useEffect(() => {
    effectiveMutedRef.current = muted;
  }, [muted]);
  const [microphoneVolume, setMicrophoneVolume] =
    useState(readMicrophoneVolume);
  const [outputVolume, setOutputVolume] = useState(readOutputVolume);
  const [outputs, setOutputs] = useState<MediaDeviceOption[]>([]);
  const [outputId, setOutputId] = useState(() =>
    typeof localStorage === "undefined"
      ? ""
      : (localStorage.getItem("lc.outputId") ?? ""),
  );
  const [outputSupported, setOutputSupported] = useState(false);
  const [cameraOff, setCameraOff] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [remoteScreenSharing, setRemoteScreenSharing] = useState(false);
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
  const activeVoiceChannelRef = useRef("");
  activeVoiceChannelRef.current = activeVoiceChannelId;
  const [connectedGroupChannelId, setConnectedGroupChannelId] = useState("");
  const [activeVoiceChannelSnapshot, setActiveVoiceChannelSnapshot] =
    useState<Channel | null>(null);
  const [callViewOpen, setCallViewOpen] = useState(false);
  const [hiddenDirectTiles, setHiddenDirectTiles] = useState<string[]>([
    "local",
    "local-screen",
  ]);
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
  const [voiceMenu, setVoiceMenu] = useState<{
    userId: string;
    name: string;
    channelId: string;
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
  const microphoneCapture = useRef<Awaited<
    ReturnType<typeof captureThresholdMicrophone>
  > | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const demoMenu = useRef<HTMLDivElement>(null);
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
    if (localVideo.current)
      localVideo.current.srcObject = screenStream.current ?? stream.current;
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
    setMicrophoneDeafened(deafened);
    const audio = remoteAudio.current;
    if (audio)
      void applyCallOutput(audio, outputVolume, deafened, outputId).catch(() =>
        setErrorMessage(
          "Could not switch the output device. Check browser permissions or select System default.",
        ),
      );
    return () => setMicrophoneDeafened(false);
  }, [deafened, outputVolume, outputId, remoteAudio]);

  useEffect(() => {
    if (authStatus === "unauthenticated") location.href = "/login";
    if (authStatus !== "authenticated" || !session?.user.id) return;
    let active = true;
    let saved: WorkspaceLocation | null = null;
    try {
      const navigation = performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined;
      saved = readWorkspaceLocation(
        window.sessionStorage,
        session.user.id,
        navigation?.type === "reload",
      );
    } catch {
      /* Storage may be unavailable in private or restricted contexts. */
    }
    void fetch("/api/servers")
      .then(async (response) => {
        if (!response.ok) throw new Error("Servers could not be loaded.");
        const data = (await response.json()) as Server[];
        if (!Array.isArray(data))
          throw new Error("Servers could not be loaded.");
        let savedFriend: Friend | undefined;
        if (saved?.view === "friends" && saved.friendId) {
          const friendResponse = await fetch("/api/friends");
          if (friendResponse.ok) {
            const nextFriends = (await friendResponse.json()) as Friend[];
            if (Array.isArray(nextFriends)) {
              savedFriend = nextFriends.find(
                (friend) =>
                  friend.id === saved!.friendId && friend.status === "accepted",
              );
              if (active) setFriends(nextFriends);
            }
          }
        }
        if (!active) return;
        const serverExists =
          saved?.view === "server" &&
          data.some((server) => server.id === saved!.serverId);
        pendingLocation.current = serverExists ? saved : null;
        locationUser.current = session.user.id;
        setServers(data);
        setSelectedServerId(
          serverExists ? saved!.serverId : (data[0]?.id ?? ""),
        );
        setFriendsView(!serverExists);
        setSelectedFriend(savedFriend ?? null);
        if (saved) setFriendTab(saved.friendTab);
        setNavigationReady(!serverExists);
      })
      .catch(() => {
        if (active) {
          setErrorMessage("The saved workspace could not be loaded.");
          setNavigationReady(true);
        }
      })
      .finally(() => {
        if (active) setServersLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [authStatus, session?.user.id]);

  useEffect(() => {
    if (
      !navigationReady ||
      !serversLoaded ||
      !session?.user.id ||
      locationUser.current !== session.user.id
    )
      return;
    try {
      saveWorkspaceLocation(window.sessionStorage, session.user.id, {
        view: friendsView ? "friends" : "server",
        serverId: selectedServerId,
        channelId: selectedChannelId,
        friendId: selectedFriend?.id ?? "",
        friendTab,
      });
    } catch {
      /* Keep navigation available if storage access is blocked. */
    }
  }, [
    navigationReady,
    serversLoaded,
    session?.user.id,
    friendsView,
    selectedServerId,
    selectedChannelId,
    selectedFriend?.id,
    friendTab,
  ]);

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
    if (userStatus !== "dnd") playVoiceSound("ring");
    const interval =
      userStatus !== "dnd"
        ? window.setInterval(() => playVoiceSound("ring"), 1600)
        : undefined;
    const timeout = window.setTimeout(() => setIncomingCall(null), 20_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [incomingCall, userStatus]);

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
    const userId = selectedFriend?.id;
    const generation = ++directHistoryGeneration.current;
    void Promise.resolve().then(() => {
      if (generation !== directHistoryGeneration.current) return;
      setDirectHistoryLoaded("");
      setDirectMessages([]);
      setDirectMessageCursor(null);
      setLoadingOlderDirect(false);
    });
    if (!userId) return;
    void fetch(`/api/direct-messages/${userId}`)
      .then(async (response) => {
        const page = await readJsonResponse<HistoryPage>(response);
        if (!response.ok) throw new Error(apiErrorMessage(page));
        if (generation !== directHistoryGeneration.current) return;
        if (!Array.isArray(page.messages))
          throw new Error("Messages could not be loaded.");
        setDirectMessages((current) =>
          mergeChatMessages(page.messages.map(toChatMessage), current),
        );
        setDirectMessageCursor(page.nextCursor);
        setDirectHistoryLoaded(userId);
      })
      .catch((error) => {
        if (generation === directHistoryGeneration.current) {
          setDirectHistoryLoaded(userId);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Messages could not be loaded.",
          );
        }
      });
    return () => {
      directHistoryGeneration.current = generation + 1;
    };
  }, [selectedFriend?.id]);

  async function loadOlderDirectMessages() {
    const userId = selectedFriend?.id;
    if (!userId || !directMessageCursor || loadingOlderDirect) return;
    const generation = directHistoryGeneration.current;
    setLoadingOlderDirect(true);
    try {
      const response = await fetch(
        `/api/direct-messages/${userId}?${new URLSearchParams(directMessageCursor)}`,
      );
      const page = await readJsonResponse<HistoryPage>(response);
      if (!response.ok) throw new Error(apiErrorMessage(page));
      if (generation !== directHistoryGeneration.current) return;
      if (!Array.isArray(page.messages))
        throw new Error("Older messages could not be loaded.");
      setDirectMessages((current) =>
        mergeChatMessages(page.messages.map(toChatMessage), current),
      );
      setDirectMessageCursor(page.nextCursor);
    } catch (error) {
      if (generation === directHistoryGeneration.current)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Older messages could not be loaded.",
        );
    } finally {
      if (generation === directHistoryGeneration.current)
        setLoadingOlderDirect(false);
    }
  }

  function openFriendsHome() {
    setSelectedFriend(null);
    setCallViewOpen(false);
    setFriendsView(true);
  }

  function openFriend(friend: Friend) {
    setFriendsView(true);
    setCallViewOpen(false);
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
    friend: { id: string; handle?: string },
  ) {
    const response = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "request"
          ? { action, userId: friend.id }
          : { action, userId: friend.id },
      ),
    });
    if (!response.ok) {
      const message = (await response.json()).error ?? "Friend action failed.";
      setErrorMessage(message);
      return false;
    } else {
      setFriendResults([]);
      setFriendSearch("");
      await loadFriends();
      invalidateSignalingToken();
      setSignalingRefreshKey((current) => current + 1);
      return true;
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
    if (selectedFriendId.current === selectedFriend.id)
      setDirectMessages((current) =>
        mergeChatMessages(current, [toChatMessage(message)]),
      );
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
    if (selectedFriendId.current !== partnerId) {
      await loadFriends();
      return;
    }
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
      fetch(`/api/servers/${selectedServerId}/channels`).then((response) => {
        if (!response.ok) throw new Error("Channels could not be loaded.");
        return response.json();
      }),
      fetch(`/api/servers/${selectedServerId}/members`).then((response) => {
        if (!response.ok) throw new Error("Members could not be loaded.");
        return response.json();
      }),
    ])
      .then(([channelData, memberData]: [Channel[], Member[]]) => {
        if (!active) return;
        const nextChannels = Array.isArray(channelData) ? channelData : [];
        setChannels(nextChannels);
        setMembers(Array.isArray(memberData) ? memberData : []);
        const savedChannel =
          pendingLocation.current?.serverId === selectedServerId
            ? pendingLocation.current.channelId
            : "";
        const textChannel = restoredTextChannel(nextChannels, savedChannel);
        lastTextChannelId.current = textChannel;
        setSelectedChannelId((current) =>
          current &&
          nextChannels.some((channel) => channel.id === current) &&
          !savedChannel
            ? current
            : textChannel || nextChannels[0]?.id || "",
        );
        pendingLocation.current = null;
        setNavigationReady(true);
        if (session?.user.id) {
          setOnlineUserIds((current) => [
            ...new Set([...current, session.user.id]),
          ]);
        }
      })
      .catch(() => {
        if (active) {
          pendingLocation.current = null;
          setFriendsView(true);
          setNavigationReady(true);
          setErrorMessage("The server could not be loaded.");
        }
      })
      .finally(() => undefined);
    return () => {
      active = false;
    };
  }, [selectedServerId, session?.user.id]);

  useEffect(() => {
    if (!serverContext) return;
    const close = (event: PointerEvent) => {
      if (!serverContextRef.current?.contains(event.target as Node))
        setServerContext(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setServerContext(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [serverContext]);

  useEffect(() => {
    if (!channelContext) return;
    channelContextRef.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus();
    const close = (event: Event) => {
      if (
        event.type === "pointerdown" &&
        channelContextRef.current?.contains(event.target as Node)
      )
        return;
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      setChannelContext(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [channelContext]);

  async function leaveServer(serverId: string) {
    setServerContext(null);
    const response = await fetch("/api/servers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, action: "leave" }),
    });
    const result = await response.json();
    if (!response.ok) {
      setErrorMessage(result.error ?? "Could not leave the server.");
      return;
    }
    if (
      activeVoiceChannel &&
      result.channelIds?.includes(activeVoiceChannel.id)
    )
      returnToPreviousTextChannel();
    invalidateSignalingToken();
    refreshAccessRef.current();
  }

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
    if (!demoMenuOpen) return;
    const closeAccountMenu = (event: PointerEvent) => {
      if (!demoMenu.current?.contains(event.target as Node)) {
        setDemoMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeAccountMenu);
    return () => document.removeEventListener("pointerdown", closeAccountMenu);
  }, [demoMenuOpen]);

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
    if (!memberMenu && !voiceMenu) return;
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
  }, [memberMenu, voiceMenu]);

  const historyChannelType = channels.find(
    (channel) => channel.id === selectedChannelId,
  )?.type;
  useEffect(() => {
    const generation = ++channelHistoryGeneration.current;
    void Promise.resolve().then(() => {
      if (generation !== channelHistoryGeneration.current) return;
      setChannelHistoryLoaded("");
      setMessages([]);
      setNextMessageCursor(null);
      setLoadingMoreMessages(false);
    });
    if (!selectedChannelId || historyChannelType !== "text") return;
    void fetch(`/api/channels/${selectedChannelId}/messages`)
      .then(async (response) => {
        const page = await readJsonResponse<HistoryPage>(response);
        if (!response.ok) throw new Error(apiErrorMessage(page));
        if (generation !== channelHistoryGeneration.current) return;
        if (!Array.isArray(page.messages))
          throw new Error("Messages could not be loaded.");
        setMessages((current) =>
          mergeChatMessages(page.messages.map(toChatMessage), current),
        );
        setNextMessageCursor(page.nextCursor);
        setChannelHistoryLoaded(selectedChannelId);
      })
      .catch((error) => {
        if (generation === channelHistoryGeneration.current) {
          setChannelHistoryLoaded(selectedChannelId);
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Messages could not be loaded.",
          );
        }
      });
    return () => {
      channelHistoryGeneration.current = generation + 1;
    };
  }, [historyChannelType, selectedChannelId]);

  async function loadMoreMessages() {
    if (!selectedChannelId || !nextMessageCursor || loadingMoreMessages) return;
    const generation = channelHistoryGeneration.current;
    setLoadingMoreMessages(true);
    try {
      const response = await fetch(
        `/api/channels/${selectedChannelId}/messages?${new URLSearchParams(nextMessageCursor)}`,
      );
      const page = await readJsonResponse<HistoryPage>(response);
      if (!response.ok) throw new Error(apiErrorMessage(page));
      if (generation !== channelHistoryGeneration.current) return;
      if (!Array.isArray(page.messages))
        throw new Error("Older messages could not be loaded.");
      setMessages((current) =>
        mergeChatMessages(page.messages.map(toChatMessage), current),
      );
      setNextMessageCursor(page.nextCursor);
    } catch (error) {
      if (generation === channelHistoryGeneration.current)
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Older messages could not be loaded.",
        );
    } finally {
      if (generation === channelHistoryGeneration.current)
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
      microphoneCapture.current?.stop();
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
        openedSocket.send(JSON.stringify({ type: "get-user-status" }));
        openedSocket.send(JSON.stringify({ type: "subscribe-user-presence" }));
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
        if (message.type === "user-status" && isUserStatus(message.status)) {
          localStorage.setItem("lc.userStatus", message.status);
          setUserStatus(message.status);
        }
        if (message.type === "access-changed") {
          invalidateSignalingToken();
          refreshAccessRef.current();
          return;
        }
        if (message.type === "channel-deleted" && message.channelId) {
          if (activeVoiceChannelRef.current === message.channelId)
            closeCallViewRef.current();
          setChannels((current) =>
            current.filter((channel) => channel.id !== message.channelId),
          );
          setSelectedChannelId((current) =>
            current === message.channelId ? "" : current,
          );
          invalidateSignalingToken();
          return;
        }
        if (
          message.type === "server-updated" &&
          message.serverId === selectedServerIdRef.current
        ) {
          void Promise.all([
            fetch("/api/servers").then((response) => response.json()),
            fetch(`/api/servers/${message.serverId}/channels`).then(
              (response) => response.json(),
            ),
            fetch(`/api/servers/${message.serverId}/members`).then((response) =>
              response.json(),
            ),
          ]).then(([nextServers, nextChannels, nextMembers]) => {
            if (Array.isArray(nextServers)) setServers(nextServers);
            if (Array.isArray(nextChannels)) {
              setChannels(nextChannels);
              setSelectedChannelId((current) =>
                nextChannels.some((channel: Channel) => channel.id === current)
                  ? current
                  : (nextChannels.find(
                      (channel: Channel) => channel.type === "text",
                    )?.id ?? ""),
              );
            }
            if (Array.isArray(nextMembers)) setMembers(nextMembers);
          });
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
          message.type === "user-presence" &&
          Array.isArray(message.userIds)
        ) {
          setOnlineUserIds(message.userIds);
          setUserStatuses(message.statuses ?? {});
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
          if (selectedFriendId.current === message.fromUserId) {
            setDirectMessages((current) =>
              mergeChatMessages(current, [directMessage]),
            );
          }
          if (!(
            friendsViewRef.current &&
            selectedFriendId.current === message.fromUserId &&
            document.visibilityState === "visible"
          )) {
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
        screen: screenSharing,
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
        screen: screenSharing,
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
    if (message.type === "screen-state") {
      setRemoteScreenSharing(Boolean(message.enabled));
      if (!message.enabled && !message.camera) {
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        remoteVisualStream.current = null;
        setRemoteHasVideo(false);
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
    setOutputSupported(
      "setSinkId" in HTMLMediaElement.prototype &&
        "setSinkId" in AudioContext.prototype,
    );
    setOutputs(
      devices
        .filter((device) => device.kind === "audiooutput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Output device ${index + 1}`,
        })),
    );
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
    const originalStream = stream.current;
    let replacement: Awaited<
      ReturnType<typeof captureThresholdMicrophone>
    > | null = null;
    try {
      replacement = await captureThresholdMicrophone(
        audioConstraints(deviceId),
        prepareVoiceActivity(),
      );
      if (stream.current !== originalStream) {
        replacement.stop();
        return;
      }
      const nextTrack = replacement.stream.getAudioTracks()[0];
      nextTrack.contentHint = "speech";
      const oldTrack = stream.current.getAudioTracks()[0];
      nextTrack.enabled = !effectiveMutedRef.current;
      const sender = connection.current
        ?.getSenders()
        .find((candidate) => candidate.track?.kind === "audio");
      if (sender) {
        await sender.replaceTrack(nextTrack);
        await preferResilientAudio(sender);
      }
      if (stream.current !== originalStream) {
        replacement.stop();
        return;
      }
      if (oldTrack) {
        stream.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      microphoneCapture.current?.stop();
      microphoneCapture.current = replacement;
      stream.current.addTrack(nextTrack);
      startDirectSpeechMonitor();
      send({
        type: "media-state",
        muted: !nextTrack.enabled,
        camera: !cameraOff,
        screen: screenSharing,
        speaking: false,
      });
    } catch {
      if (microphoneCapture.current !== replacement) replacement?.stop();
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
      if (localVideo.current)
        localVideo.current.srcObject = screenStream.current ?? stream.current;
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
    const captureGeneration = peerGeneration.current;
    directRoomId.current = channelId;
    directReconnectInProgress.current = reconnecting;
    setJoining(true);
    setStatus(
      reconnecting ? "Reconnecting signaling..." : "Requesting microphone...",
    );
    setMediaNotice("");

    if (!reconnecting) {
      try {
        const captured = await captureThresholdMicrophone(
          audioConstraints(microphoneId),
          prepareVoiceActivity(),
        );
        if (
          captureGeneration !== peerGeneration.current ||
          directRoomId.current !== channelId
        ) {
          captured.stop();
          return;
        }
        microphoneCapture.current = captured;
        stream.current = microphoneCapture.current.stream;
        stream.current.getAudioTracks().forEach((track) => {
          track.enabled = !effectiveMutedRef.current;
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
    microphoneCapture.current?.stop();
    microphoneCapture.current = null;
    screenStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
  }

  function leaveRoom() {
    const groupChannelId = activeGroupChannelId.current;
    if (groupChannelId) handleGroupConnection(groupChannelId, false);
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
    setCameraOff(true);
    setScreenSharing(false);
    setRemoteScreenSharing(false);
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
    setHiddenDirectTiles(["local", "local-screen"]);
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
    if (deafened) return;
    const track = stream.current?.getAudioTracks()[0];
    if (!track) {
      setMuted((current) => !current);
      return;
    }
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
      send({
        type: "media-state",
        muted: !track.enabled,
        camera: !cameraOff,
        screen: screenSharing,
        speaking: false,
      });
    }
  }

  function toggleDeafen() {
    const next = !deafened;
    setMicrophoneDeafened(next);
    setDeafened(next);
    const nextMuted = microphoneMuted || next;
    effectiveMutedRef.current = nextMuted;
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    if (remoteAudio.current) remoteAudio.current.muted = next;
    send({
      type: "media-state",
      muted: nextMuted,
      camera: !cameraOff,
      screen: screenSharing,
      speaking: false,
    });
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
        screen: screenSharing,
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
      if (localVideo.current)
        localVideo.current.srcObject = screenStream.current ?? stream.current;
      const peer = connection.current;
      if (peer && !screenStream.current) {
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
        screen: screenSharing,
        speaking: false,
      });
    } catch {
      setErrorMessage(
        "The camera could not be started. Check browser permission.",
      );
    }
  }

  async function stopScreenShare() {
    const currentScreen = screenStream.current;
    if (!currentScreen) return;
    screenStream.current = null;
    currentScreen.getTracks().forEach((track) => track.stop());
    const cameraTrack = stream.current?.getVideoTracks()[0] ?? null;
    const sender = connection.current
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(cameraTrack);
      if (cameraTrack) await preferVideoDetail(sender);
    }
    if (localVideo.current) localVideo.current.srcObject = stream.current;
    setScreenSharing(false);
    send({ type: "screen-state", enabled: false, camera: !cameraOff });
    send({
      type: "media-state",
      muted,
      camera: !cameraOff,
      screen: false,
      speaking: false,
    });
  }

  async function toggleScreenShare() {
    if (screenStream.current) {
      await stopScreenShare();
      return;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) throw new Error("No screen track");
      screenTrack.contentHint = "detail";
      screenStream.current = display;
      screenTrack.addEventListener("ended", () => void stopScreenShare(), {
        once: true,
      });
      const peer = connection.current;
      if (peer) {
        const sender = peer
          .getSenders()
          .find((candidate) => candidate.track?.kind === "video");
        if (sender) {
          await sender.replaceTrack(screenTrack);
          await preferVideoDetail(sender);
        } else {
          const nextSender = peer.addTrack(screenTrack, display);
          await preferVideoDetail(nextSender);
          await createOffer();
        }
      }
      if (localVideo.current) localVideo.current.srcObject = display;
      setScreenSharing(true);
      setCallViewOpen(true);
      send({ type: "screen-state", enabled: true, camera: !cameraOff });
      send({
        type: "media-state",
        muted,
        camera: !cameraOff,
        screen: true,
        speaking: false,
      });
    } catch {
      setErrorMessage(
        "The screen could not be shared. Check browser permission.",
      );
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !selectedChannelId) return;
    const generation = channelHistoryGeneration.current;
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
      if (generation !== channelHistoryGeneration.current) return;
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
      setServers((current) => [...current, { ...server, role: "owner" }]);
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
    inSettings = false,
  ) {
    if (!inSettings) setAccountMenuOpen(false);
    setMessageAccount({ id: userId, name });
    setReturnToDemoManager(fromDemoManager);
    if (!inSettings) setForm("messages");
    setAccountMessages([]);
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

  async function deleteAccountMessages(serverId?: string) {
    const query = serverId ? `?serverId=${encodeURIComponent(serverId)}` : "";
    const response = await fetch(
      `/api/users/${messageAccount.id}/messages${query}`,
      { method: "DELETE" },
    );
    if (!response.ok) {
      const result = await readJsonResponse<{ error?: string }>(response);
      throw new Error(result?.error ?? "Messages could not be deleted.");
    }
    setAccountMessages((current) =>
      serverId
        ? current.filter((message) => message.serverId !== serverId)
        : [],
    );
    setDeleteMessageCandidate(null);
    setNoticeMessage(
      serverId ? "Messages deleted in this server." : "All messages deleted.",
    );
  }

  function requestMessageDeletion(
    messageId: string,
    preview: string,
    conversationUserId?: string,
    alreadyDeleted = false,
  ) {
    setMessageMenu(null);
    setErrorMessage("");
    setPermanentMessageDeletion(alreadyDeleted);
    setDeleteMessageCandidate({
      id: messageId,
      preview,
      conversationUserId,
      alreadyDeleted,
    });
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
    setReturnToDemoManager(false);
  }

  async function saveRename(
    event: FormEvent | undefined,
    target = renameTarget,
  ) {
    event?.preventDefault();
    if (!target) return;
    const name = target.name.trim();
    if (!name) return;
    const endpoint =
      target.kind === "user"
        ? "/api/users/me"
        : target.kind === "demo"
          ? "/api/demo-accounts"
          : target.kind === "server"
            ? "/api/servers"
            : `/api/servers/${selectedServerId}/channels`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        ...(target.kind === "demo"
          ? { demoUserId: target.id, action: "rename" }
          : target.kind === "server"
            ? { serverId: target.id }
            : target.kind === "channel"
              ? { channelId: target.id }
              : {}),
      }),
    });
    const result = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      setErrorMessage(result?.error ?? "The name could not be changed.");
      return;
    }
    if (target.kind === "demo") {
      setDemoAccounts((current) =>
        current.map((account) =>
          account.id === target.id ? { ...account, name } : account,
        ),
      );
      setMembers((current) =>
        current.map((member) =>
          member.id === target.id ? { ...member, name } : member,
        ),
      );
    } else if (target.kind === "server") {
      setServers((current) =>
        current.map((server) =>
          server.id === target.id ? { ...server, name } : server,
        ),
      );
    } else if (target.kind === "channel") {
      setChannels((current) =>
        current.map((channel) =>
          channel.id === target.id ? { ...channel, name } : channel,
        ),
      );
      setActiveVoiceChannelSnapshot((current) =>
        current?.id === target.id ? { ...current, name } : current,
      );
    }
    setRenameTarget(null);
    setNoticeMessage(
      target.kind === "user"
        ? "Username changed."
        : `${
            target.kind === "server"
              ? "Server"
              : target.kind === "channel"
                ? "Channel"
                : "Demo account"
          } renamed.`,
    );
    if (target.kind === "user") await updateSession();
  }

  function selectVoiceChannel(channel: Channel) {
    if (activeVoiceChannelId === channel.id) {
      setCallViewOpen(true);
      return;
    }
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
  const directRemoteName =
    voicePresence[activeVoiceChannelId]?.find(
      (participant) => participant.userId !== session?.user.id,
    )?.name ??
    (activeVoiceChannelId.startsWith("friend:")
      ? activeVoiceChannel?.name
      : "Guest");
  const localDirectTileId = screenSharing ? "local-screen" : "local";
  const remoteDirectTileId = remoteScreenSharing ? "remote-screen" : "remote";
  const directLocalLabel = `${session?.user.name ?? "You"}${screenSharing ? " — screen" : ""}`;
  const directRemoteLabel = `${directRemoteName}${remoteScreenSharing ? " — screen" : ""}`;
  const hideDirectTile = (id: string) => {
    setHiddenDirectTiles((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setFocusedDirectVideo(null);
  };
  const directHiddenMenu = (
    <HiddenTilesMenu
      tiles={[
        { id: localDirectTileId, label: directLocalLabel },
        ...(callPeerPresent
          ? [{ id: remoteDirectTileId, label: directRemoteLabel }]
          : []),
      ]}
      hiddenIds={hiddenDirectTiles}
      onRestore={(id) => {
        setFocusedDirectVideo(null);
        setHiddenDirectTiles((current) =>
          current.filter((hidden) => hidden !== id),
        );
      }}
    />
  );
  const directSelfViewButton = (
    <SelfViewButton
      hidden={
        hiddenDirectTiles.includes("local") ||
        hiddenDirectTiles.includes("local-screen")
      }
      onToggle={() => {
        setFocusedDirectVideo(null);
        setHiddenDirectTiles((current) => {
          const others = current.filter(
            (id) => id !== "local" && id !== "local-screen",
          );
          return current.includes("local") || current.includes("local-screen")
            ? others
            : [...others, "local", "local-screen"];
        });
      }}
    />
  );
  const openChannelContext = (event: React.MouseEvent, channel: Channel) => {
    if (!isSelectedServerOwner) return;
    event.preventDefault();
    setChannelContext({
      channel,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 208)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 60)),
    });
  };
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

  const voiceReady = Boolean(
    activeVoiceChannel &&
    (activeVoiceChannel.type === "voice_group"
      ? connectedGroupChannelId === activeVoiceChannel.id
      : joined && !joining),
  );
  const connectionLabel =
    activeVoiceChannel && voiceReady
      ? `Connected to "${activeVoiceChannel.name}"`
      : activeVoiceChannel
        ? `Connecting to "${activeVoiceChannel.name}"…`
        : "Not connected";
  const renderAudioDeviceOptions = (mode: "input" | "output" | "both") => (
    <AudioDeviceOptions
      mode={mode}
      outputs={outputs}
      outputId={outputId}
      outputSupported={outputSupported}
      microphoneVolume={microphoneVolume}
      outputVolume={outputVolume}
      onOutputChange={(id) => {
        localStorage.setItem("lc.outputId", id);
        setOutputId(id);
      }}
      onMicrophoneVolumeChange={(value) => {
        localStorage.setItem("lc.microphoneVolume", String(value));
        setMicrophoneVolume(value);
      }}
      onOutputVolumeChange={(value) => {
        localStorage.setItem("lc.outputVolume", String(value));
        setOutputVolume(value);
      }}
    />
  );
  const audioDeviceOptions = renderAudioDeviceOptions("input");
  const profilePanel = session && (
    <footer className="profileBar">
      <div
        className={`accountMenu profileMenu ${accountMenuOpen ? "open" : ""}`}
      >
        <UserStatusMenu
          name={session.user.name ?? "You"}
          status={userStatus}
          speaking={directLocalSpeaking}
          onProfile={() =>
            setProfileUser({
              id: session.user.id,
              name: session.user.name ?? "You",
              handle: session.user.handle ?? undefined,
            })
          }
          onChange={(next) => {
            localStorage.setItem("lc.userStatus", next);
            setUserStatus(next);
            if (presenceSocket.current?.readyState === WebSocket.OPEN)
              presenceSocket.current.send(
                JSON.stringify({ type: "set-user-status", status: next }),
              );
          }}
        />
        {!activeVoiceChannel && (
          <div className="controls profileMicrophone">
            <DeviceMenu
              kind="microphone"
              actionUnavailable={deafened}
              extraOptions={audioDeviceOptions}
              disabled={muted}
              devices={microphones}
              selectedId={microphoneId}
              onAction={toggleAudio}
              onSelect={selectMicrophone}
            />
          </div>
        )}
        <div className="controls profileDeafen">
          <DeviceMenu
            kind="headphones"
            disabled={deafened}
            devices={[]}
            selectedId={outputId}
            onAction={toggleDeafen}
            onSelect={() => {}}
            extraOptions={renderAudioDeviceOptions("output")}
          />
        </div>
        <button
          className="profileSettings"
          aria-label="Settings"
          aria-haspopup="dialog"
          title="Settings"
          aria-expanded={accountMenuOpen}
          onClick={() => {
            setUserSettingsSection("account");
            setAccountMenuOpen((current) => !current);
          }}
        >
          <SettingsIcon />
        </button>
      </div>
      {activeVoiceChannel && (
        <div className="profileConnectionDetails">
          <span>
            <strong role="status">{connectionLabel}</strong>
            <small>
              {voiceReady ? "Connection quality" : "Preparing call…"}
            </small>
          </span>
          {voiceReady && (
            <ConnectionDiagnostics
              ping={directPing ?? channelPing[activeVoiceChannel.id]}
              diagnostics={callDiagnostics}
            />
          )}
          <button
            className="connectionDisconnect"
            aria-label="Disconnect"
            title="Disconnect"
            onClick={() => {
              if (directRoomId.current.startsWith("friend:")) endFriendCall();
              else returnToPreviousTextChannel();
            }}
          >
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 15v-4c5-5 13-5 18 0v4l-5-1v-3a13 13 0 0 0-8 0v3z" />
            </svg>
          </button>
        </div>
      )}
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

  const serverContextMenu = serverContext && (
    <div
      className="messageContextMenu"
      role="menu"
      ref={serverContextRef}
      style={{ left: serverContext.x, top: serverContext.y }}
    >
      <button
        className="danger"
        role="menuitem"
        onClick={() => {
          const target = serverContext.server;
          setServerContext(null);
          if (target.role === "owner") {
            void switchServer(target.id).then(() => {
              setFriendsView(false);
              setDeleteServerOpen(true);
            });
          } else void leaveServer(target.id);
        }}
      >
        {serverContext.server.role === "owner"
          ? "Delete server"
          : "Leave server"}
      </button>
    </div>
  );
  const channelContextMenu = channelContext && isSelectedServerOwner && (
    <div
      className="messageContextMenu"
      role="menu"
      aria-label="Channel actions"
      ref={channelContextRef}
      style={{ left: channelContext.x, top: channelContext.y }}
    >
      <button
        role="menuitem"
        onClick={() => {
          setRenameTarget({ kind: "channel", ...channelContext.channel });
          setChannelContext(null);
        }}
      >
        Rename channel
      </button>
    </div>
  );

  const mediaSettingsContent = (
    <div className="mediaSettings">
      <p>
        Grant access once so LC can show device names and use your saved choices
        when you join.
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
      <details className="settingsDeviceChoices" open>
        <summary>Input/output devices</summary>
        <DeviceSelection
          label="Microphone"
          devices={microphones}
          selectedId={microphoneId}
          onSelect={(deviceId) => {
            if (activeVoiceChannel?.type === "voice_direct" && joined)
              void changeActiveMicrophone(deviceId);
            else selectMicrophone(deviceId);
          }}
        />
        {renderAudioDeviceOptions("both")}
      </details>
      <DeviceSelection
        label="Camera"
        devices={cameras}
        selectedId={cameraId}
        onSelect={selectCamera}
      />
      <small>
        Camera access is requested here for setup, but your camera remains off
        when joining a channel.
      </small>
      <MediaTests
        microphoneId={microphoneId}
        cameraId={cameraId}
        outputVolume={outputVolume}
        outputId={outputId}
        deafened={deafened}
      />
    </div>
  );
  const accountMessagesContent = (
    <div className="accountMessageList">
      <p>
        Messages written by <strong>{messageAccount.name}</strong>
      </p>
      {accountMessages.length === 0 && (
        <p className="empty">No messages found.</p>
      )}
      {groupMessagesByServer(accountMessages, selectedServerId).map((group) => (
        <details
          className="serverMessageGroup"
          key={group.id}
          open={group.id === selectedServerId}
        >
          <summary>
            <strong>{group.name}</strong>
            {group.id === selectedServerId && <small>Current server</small>}
            <span>{group.messages.length} messages</span>
          </summary>
          <MessageDeleteAction
            key={`${messageAccount.id}:${group.id}`}
            label="Delete all messages in this server"
            confirmation={`Delete all messages written by ${messageAccount.name} in "${group.name}"? Messages in other servers will be kept. This cannot be undone.`}
            onDelete={() => deleteAccountMessages(group.id)}
          />
          {group.messages.map((message) => (
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
              {accountMenuOpen && deleteMessageCandidate?.id === message.id && (
                <div className="settingsDangerZone">
                  <p>Delete this message?</p>
                  <label>
                    <input
                      type="checkbox"
                      checked={permanentMessageDeletion}
                      disabled={deleteMessageCandidate?.alreadyDeleted}
                      onChange={(event) =>
                        setPermanentMessageDeletion(event.target.checked)
                      }
                    />
                    Permanently remove this message
                  </label>
                  <button
                    type="button"
                    onClick={() => setDeleteMessageCandidate(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => void deleteMessage()}
                  >
                    Confirm delete
                  </button>
                </div>
              )}
            </article>
          ))}
        </details>
      ))}
      {accountMessages.length > 0 && (
        <MessageDeleteAction
          key={messageAccount.id}
          label="Delete all messages"
          confirmation={`Delete all messages written by ${messageAccount.name} across every server? This cannot be undone.`}
          onDelete={() => deleteAccountMessages()}
        />
      )}
    </div>
  );

  const profileOverlay = profileUser && session && (
    <UserProfile
      key={profileUser.id}
      user={{
        ...friends.find((friend) => friend.id === profileUser.id),
        ...profileUser,
      }}
      status={
        profileUser.id === session.user.id
          ? statusLabels[userStatus]
          : onlineUserIds.includes(profileUser.id)
            ? statusLabels[userStatuses[profileUser.id] ?? "online"]
            : "Offline"
      }
      mutualServers={
        members.some((member) => member.id === profileUser.id)
          ? servers
              .filter((server) => server.id === selectedServerId)
              .map((server) => server.name)
          : []
      }
      onClose={() => setProfileUser(null)}
      requestPending={friends.some(
        (friend) =>
          friend.id === profileUser.id &&
          friend.status === "pending" &&
          !friend.incoming,
      )}
      friendActionsUnavailable={
        profileUser.id !== session.user.id &&
        session.user.role === "demo" &&
        !friends.some(
          (friend) =>
            friend.id === profileUser.id && friend.status === "accepted",
        )
      }
      onAddFriend={
        profileUser.id !== session.user.id &&
        session.user.role !== "demo" &&
        !friends.some((friend) => friend.id === profileUser.id)
          ? async () => {
              if (!(await friendAction("request", profileUser)))
                throw new Error(
                  "The friend request could not be sent. Please try again.",
                );
            }
          : undefined
      }
      onAcceptFriend={
        session.user.role !== "demo" &&
        friends.some(
          (friend) =>
            friend.id === profileUser.id &&
            friend.status === "pending" &&
            friend.incoming,
        )
          ? async () => {
              if (!(await friendAction("accept", profileUser)))
                throw new Error(
                  "The friend request could not be accepted. Please try again.",
                );
            }
          : undefined
      }
      onMessage={
        friends.some(
          (friend) =>
            friend.id === profileUser.id && friend.status === "accepted",
        )
          ? () => {
              const friend = friends.find(
                (friend) => friend.id === profileUser.id,
              );
              if (friend) openFriend(friend);
              setProfileUser(null);
            }
          : undefined
      }
    />
  );
  const settingsOverlay = session &&
    (accountMenuOpen || (serverSettingsOpen && isSelectedServerOwner)) && (
      <SettingsModal
        title={accountMenuOpen ? "User settings" : "Server settings"}
        onClose={() => {
          setAccountMenuOpen(false);
          setServerSettingsOpen(false);
          setDeleteMessageCandidate(null);
        }}
        navigation={
          <>
            <p className="settingsNavLabel">
              {accountMenuOpen
                ? session.user.name
                : servers.find((server) => server.id === selectedServerId)
                    ?.name}
            </p>
            {(accountMenuOpen
              ? [
                  ["account", "My account"],
                  ["media", "Voice & video"],
                  ["messages", "My messages"],
                ]
              : [
                  ["overview", "Overview"],
                  ["channels", "Channels"],
                  ["members", "Members"],
                  ["delete", "Delete server"],
                ]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`${id === "delete" ? "danger" : ""} ${id === (accountMenuOpen ? userSettingsSection : serverSettingsSection) ? "active" : ""}`}
                aria-current={
                  id ===
                  (accountMenuOpen
                    ? userSettingsSection
                    : serverSettingsSection)
                    ? "page"
                    : undefined
                }
                onClick={() => {
                  if (accountMenuOpen) {
                    setUserSettingsSection(id);
                    if (id === "media") void loadMediaDevices();
                    if (id === "messages")
                      void openAccountMessages(
                        session.user.id,
                        session.user.name ?? "My account",
                        false,
                        true,
                      );
                  } else {
                    setServerSettingsSection(id);
                    if (id === "members") void loadFriends();
                  }
                }}
              >
                {label}
              </button>
            ))}
            {accountMenuOpen && (
              <button
                type="button"
                className="danger"
                onClick={() => void signOut({ callbackUrl: "/login" })}
              >
                Log out
              </button>
            )}
          </>
        }
      >
        {errorMessage && (
          <p role="alert" className="settingsFeedback">
            {errorMessage}
          </p>
        )}
        {noticeMessage && (
          <p role="status" className="settingsFeedback">
            {noticeMessage}
          </p>
        )}
        {accountMenuOpen ? (
          <>
            {userSettingsSection === "account" && (
              <>
                <h3>My account</h3>
                <div className="settingsAccountCard">
                  <span className="avatar">
                    {session.user.name?.[0]?.toUpperCase()}
                  </span>
                  <div>
                    <strong>{session.user.name}</strong>
                    <p>
                      {session.user.handle
                        ? formatUserHandle(session.user.handle)
                        : "My account"}
                    </p>
                    <small>{statusLabels[userStatus]}</small>
                  </div>
                </div>
                <SettingsNameForm
                  key={session.user.name}
                  name={session.user.name ?? ""}
                  label="Display name"
                  onSave={(name) =>
                    saveRename(undefined, {
                      kind: "user",
                      id: session.user.id,
                      name,
                    })
                  }
                />
                <p className="settingsDescription">
                  Your display name is visible to friends and server members.
                </p>
              </>
            )}
            {userSettingsSection === "media" && (
              <>
                <h3>Voice & video</h3>
                {mediaSettingsContent}
              </>
            )}
            {userSettingsSection === "messages" && (
              <>
                <h3>My messages</h3>
                {accountMessagesContent}
              </>
            )}
          </>
        ) : (
          <>
            {serverSettingsSection === "overview" && (
              <>
                <h3>Server overview</h3>
                <SettingsNameForm
                  key={selectedServerId}
                  name={
                    servers.find((server) => server.id === selectedServerId)
                      ?.name ?? ""
                  }
                  label="Server name"
                  onSave={(name) =>
                    saveRename(undefined, {
                      kind: "server",
                      id: selectedServerId,
                      name,
                    })
                  }
                />
                <p className="settingsDescription">
                  {members.length} members · {channels.length} channels
                </p>
              </>
            )}
            {serverSettingsSection === "channels" && (
              <>
                <h3>Channels</h3>
                <ChannelManager
                  key={selectedServerId}
                  channels={channels}
                  onRename={async (channel, name) => {
                    await saveRename(undefined, {
                      kind: "channel",
                      id: channel.id,
                      name,
                    });
                  }}
                  onDelete={async (channel) => {
                    const response = await fetch(
                      `/api/servers/${selectedServerId}/channels`,
                      {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ channelId: channel.id }),
                      },
                    );
                    const result = await readJsonResponse<{ error?: string }>(
                      response,
                    );
                    if (!response.ok)
                      throw new Error(
                        result?.error ?? "Channel could not be deleted.",
                      );
                    if (activeVoiceChannelRef.current === channel.id)
                      returnToPreviousTextChannel();
                    const remaining = channels.filter(
                      (item) => item.id !== channel.id,
                    );
                    setChannels(remaining);
                    setSelectedChannelId((current) =>
                      current === channel.id
                        ? (remaining.find((item) => item.type === "text")?.id ??
                          "")
                        : current,
                    );
                    invalidateSignalingToken();
                    setNoticeMessage("Channel deleted.");
                  }}
                />
                <h4>Create channel</h4>
                <form className="settingsNameForm" onSubmit={createChannel}>
                  <label>
                    Name
                    <input
                      required
                      maxLength={60}
                      value={formName}
                      onChange={(event) => setFormName(event.target.value)}
                    />
                  </label>
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
                  <button type="submit" className="primary">
                    Create channel
                  </button>
                </form>
              </>
            )}
            {serverSettingsSection === "members" && (
              <>
                <h3>Members</h3>
                <div className="settingsChannelList">
                  {members.map((member) => (
                    <p key={member.id}>
                      <strong>{member.name}</strong>
                      <small>{member.role}</small>
                    </p>
                  ))}
                </div>
                <h4>Add friends to server</h4>
                <p className="settingsDescription">
                  Friends already in this server are hidden.
                </p>
                <input
                  autoFocus
                  value={serverFriendSearch}
                  onChange={(event) =>
                    setServerFriendSearch(event.target.value)
                  }
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

                <button
                  className="primary"
                  type="button"
                  disabled={selectedServerFriendIds.length === 0}
                  onClick={() => void addSelectedFriendsToServer()}
                >
                  Add selected ({selectedServerFriendIds.length})
                </button>
              </>
            )}
            {serverSettingsSection === "delete" && (
              <section className="settingsDangerZone">
                <h3>Delete server</h3>
                <p>
                  This permanently deletes{" "}
                  <strong>
                    {
                      servers.find((server) => server.id === selectedServerId)
                        ?.name
                    }
                  </strong>
                  , including all its channels and messages. This cannot be
                  undone.
                </p>
                <button
                  className="danger"
                  type="button"
                  onClick={() => void deleteServer()}
                >
                  Permanently delete server
                </button>
              </section>
            )}
          </>
        )}
      </SettingsModal>
    );
  const sidebarStyle = {
    "--preferred-sidebar-width":
      sidebarWidth === null ? undefined : `${sidebarWidth}px`,
  } as CSSProperties;
  const sidebarResizer = (
    <SidebarResizer
      onResize={(width) => {
        setSidebarWidth(width);
        localStorage.setItem("lc.sidebarWidth", String(width));
      }}
      onReset={() => {
        setSidebarWidth(null);
        localStorage.removeItem("lc.sidebarWidth");
      }}
    />
  );
  const panelClasses = `${activeVoiceChannel ? "voiceActive" : ""} ${serverListToggled ? "serverListToggled" : ""} ${channelsHidden ? "channelsHidden" : ""} ${userListToggled ? "userListToggled" : ""}`;
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
        title="Show or hide channels"
        aria-label="Show or hide channels"
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
        <h2 id="direct-delete-title">
          {deleteMessageCandidate.alreadyDeleted
            ? "Remove deleted message?"
            : "Delete message?"}
        </h2>
        <p>
          {deleteMessageCandidate.alreadyDeleted ? (
            "This permanently removes the deleted-message placeholder from both histories. This cannot be undone."
          ) : (
            <>
              The content will be erased for both people and replaced with{" "}
              <em>Deleted message</em>.
            </>
          )}
        </p>
        <blockquote>{deleteMessageCandidate.preview}</blockquote>
        <label className="permanentDeleteOption">
          <input
            type="checkbox"
            checked={permanentMessageDeletion}
            disabled={deleteMessageCandidate?.alreadyDeleted}
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

  const groupCall = session && activeVoiceChannel?.type === "voice_group" && (
    <GroupCall
      key={`${activeVoiceChannel.id}-${voiceJoinKey}`}
      channelId={activeVoiceChannel.id}
      currentUserName={session.user.name ?? "You"}
      microphoneId={microphoneId}
      cameraId={cameraId}
      initialMuted={microphoneMuted}
      deafened={deafened}
      outputVolume={outputVolume / 100}
      outputId={outputId}
      audioDeviceOptions={audioDeviceOptions}
      microphones={microphones}
      cameras={cameras}
      autoJoin={voiceJoinTarget === activeVoiceChannel.id}
      viewOpen={callViewOpen}
      onOpenView={() => setCallViewOpen(true)}
      onMicrophoneChange={selectMicrophone}
      onCameraChange={selectCamera}
      onConnectionChange={(present) =>
        handleGroupConnection(activeVoiceChannel.id, present)
      }
      onMediaStateChange={(media) => {
        if (activeGroupChannelId.current !== activeVoiceChannel.id) return;
        if (!deafened) setMuted(media.muted);
        sendGroupPresence(
          activeVoiceChannel.id,
          true,
          presenceSocket.current,
          media,
        );
      }}
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
  );

  if (
    !session ||
    authStatus !== "authenticated" ||
    !serversLoaded ||
    !navigationReady
  ) {
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
      <WorkspaceShell
        call={groupCall}
        className={`workspace friendsScreen ${panelClasses}`}
        style={sidebarStyle}
      >
        <aside className="workspaceRail">
          <button
            className="workspaceLogo friendsActive"
            aria-label="Friends"
            aria-current="page"
            onClick={openFriendsHome}
          >
            LC
            {notificationCount > 0 && (
              <span className="notificationBadge">{notificationCount}</span>
            )}
          </button>
          <nav
            className="serverScroller"
            aria-label="Servers"
            style={{ height: Math.max(0, servers.length * 60 - 6) }}
          >
            {servers.map((server) => (
              <div
                className="serverButtonWrap"
                key={server.id}
                onPointerEnter={(event) =>
                  event.currentTarget.style.setProperty(
                    "--server-tooltip-top",
                    `${event.currentTarget.getBoundingClientRect().top + 23}px`,
                  )
                }
              >
                <button
                  className="workspaceButton"
                  aria-label={server.name}
                  title={server.name}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setServerContext({
                      server,
                      x: Math.min(event.clientX, window.innerWidth - 200),
                      y: Math.min(event.clientY, window.innerHeight - 64),
                    });
                  }}
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
          </nav>
          {session.user.role !== "demo" && (
            <div
              className="serverButtonWrap addServerButton"
              onPointerEnter={(event) =>
                event.currentTarget.style.setProperty(
                  "--server-tooltip-top",
                  `${event.currentTarget.getBoundingClientRect().top + 23}px`,
                )
              }
            >
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
              className={`friendsHomeButton ${!selectedFriend ? "active" : ""}`}
              type="button"
              aria-current={!selectedFriend ? "page" : undefined}
              onClick={openFriendsHome}
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
                  <i
                    className={`statusDot status-${userStatuses[friend.id] ?? "offline"}`}
                    title={
                      onlineUserIds.includes(friend.id)
                        ? statusLabels[userStatuses[friend.id] ?? "online"]
                        : "Offline"
                    }
                  />
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
          {sidebarResizer}
        </aside>
        <section className="room friendsRoom">
          <header className="roomHeader">
            {selectedFriend ? (
              <button
                className="profileLink"
                type="button"
                onClick={() => setProfileUser(selectedFriend)}
              >
                {selectedFriend.name}
              </button>
            ) : (
              <strong>Friends</strong>
            )}
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
                      type="button"
                      className="friendRow"
                      data-status={userStatuses[friend.id] ?? "offline"}
                      key={friend.id}
                      onClick={() => setProfileUser(friend)}
                    >
                      <span className="friendListAvatar" aria-hidden="true">
                        {friend.name[0]?.toUpperCase()}
                        <i
                          className={`friendStatusDot statusDot status-${userStatuses[friend.id] ?? "offline"}`}
                        />
                      </span>
                      <span className="friendConversationLink">
                        <b>{friend.name}</b>
                        <small>
                          {onlineUserIds.includes(friend.id)
                            ? statusLabels[userStatuses[friend.id] ?? "online"]
                            : "Offline"}{" "}
                          · {formatUserHandle(friend.handle)}
                        </small>
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
              <ChatHistory
                key={selectedFriend.id}
                threadId={selectedFriend.id}
                messages={directMessages}
                ready={directHistoryLoaded === selectedFriend.id}
                hasMore={Boolean(directMessageCursor)}
                loadingOlder={loadingOlderDirect}
                onLoadOlder={loadOlderDirectMessages}
                ownUserId={session.user.id}
              >
                {directMessages.map((message) => (
                  <article
                    className={`${message.authorId === session.user.id ? "messageOwn" : "messageOther"} ${message.kind === "call" ? "callHistory" : ""} ${message.deleted ? "deletedMessage" : ""}`}
                    key={message.id}
                    data-message-id={message.id}
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
                        <MessageHeader
                          name={message.author}
                          time={message.time}
                          onProfile={() =>
                            setProfileUser({
                              id: message.authorId,
                              name: message.author,
                              ...friends.find(
                                (friend) => friend.id === message.authorId,
                              ),
                            })
                          }
                        />
                        <p>{message.text}</p>
                      </>
                    )}
                    {message.authorId === session.user.id && (
                      <button
                        type="button"
                        className="directMessageDelete"
                        aria-label={
                          message.deleted
                            ? "Delete permanently"
                            : "Delete message"
                        }
                        title={
                          message.deleted
                            ? "Delete permanently"
                            : "Delete message"
                        }
                        onClick={() =>
                          requestMessageDeletion(
                            message.id,
                            message.text,
                            selectedFriend.id,
                            message.deleted,
                          )
                        }
                      >
                        {message.deleted ? "Remove" : "Delete"}
                      </button>
                    )}
                  </article>
                ))}
              </ChatHistory>
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
              </div>
              <div className="videoGrid friendsParticipantGrid">
                <div
                  className={`videoCard ${remoteScreenSharing ? "screenShare" : !remoteHasVideo ? "nameOnly" : ""} ${!callPeerPresent || hiddenDirectTiles.includes(remoteDirectTileId) ? "videoHidden" : ""}`}
                >
                  <video ref={remoteVideo} autoPlay muted playsInline />
                  <HideTileButton
                    label={directRemoteLabel}
                    onHide={() => hideDirectTile(remoteDirectTileId)}
                  />
                  <span>
                    {directRemoteName}
                    {remoteScreenSharing ? " — screen" : ""}
                  </span>
                </div>
                <div
                  className={`videoCard ${screenSharing ? "screenShare" : cameraOff ? "nameOnly" : ""} ${hiddenDirectTiles.includes(localDirectTileId) ? "videoHidden" : ""}`}
                >
                  <video ref={localVideo} autoPlay muted playsInline />
                  <HideTileButton
                    label={directLocalLabel}
                    onHide={() => hideDirectTile(localDirectTileId)}
                  />
                  <span>
                    {session.user.name ?? "You"}
                    {screenSharing ? " — screen" : ""}
                  </span>
                </div>
                <div className="callVisibilityControls">
                  {directSelfViewButton}
                  {directHiddenMenu}
                </div>
              </div>
              <div
                className="controls voiceDock friendsCallControls"
                aria-busy={!voiceReady}
              >
                {audioPlaybackBlocked && (
                  <button type="button" onClick={() => void playRemoteAudio()}>
                    Enable sound
                  </button>
                )}
                <DeviceMenu
                  kind="microphone"
                  actionUnavailable={deafened}
                  extraOptions={audioDeviceOptions}
                  unavailable={!voiceReady}
                  disabled={muted}
                  devices={microphones}
                  selectedId={microphoneId}
                  onAction={toggleAudio}
                  onRestart={() => void changeActiveMicrophone(microphoneId)}
                  onSelect={(deviceId) => void changeActiveMicrophone(deviceId)}
                />
                <DeviceMenu
                  kind="camera"
                  unavailable={!voiceReady}
                  disabled={cameraOff}
                  devices={cameras}
                  selectedId={cameraId}
                  onAction={() => void toggleVideo()}
                  onSelect={(deviceId) => void changeActiveCamera(deviceId)}
                />
                <button
                  className={screenSharing ? "stopSharing" : ""}
                  disabled={!voiceReady}
                  onClick={() => void toggleScreenShare()}
                >
                  {screenSharing ? "Stop sharing" : "Share screen"}
                </button>
                <button
                  className="soundboardPlaceholder"
                  disabled
                  title="Soundboard — coming soon"
                >
                  Soundboard
                </button>
              </div>
            </section>
          )}
        </section>
        <aside className="memberSidebar friendsInfoSidebar">
          <header className="memberSidebarHeader">
            Profile
            {closeUserList}
          </header>
          <div className="memberScroll">
            {selectedFriend ? (
              <button
                type="button"
                className="friendProfileCard"
                onClick={() => setProfileUser(selectedFriend)}
              >
                <span className="avatar">
                  {selectedFriend.name[0]?.toUpperCase()}
                </span>
                <strong>{selectedFriend.name}</strong>
                <small>
                  {onlineUserIds.includes(selectedFriend.id)
                    ? statusLabels[userStatuses[selectedFriend.id] ?? "online"]
                    : "Offline"}
                </small>
                <small>{formatUserHandle(selectedFriend.handle)}</small>
              </button>
            ) : (
              <p className="empty">Select a friend to view their profile.</p>
            )}
          </div>
          {legalLinks}
        </aside>
        {incomingCallOverlay}
        {legalOverlay}
        {settingsOverlay}
        {profileOverlay}
        {serverContextMenu}
        {directDeletionDialog}
      </WorkspaceShell>
    );
  }

  if (serversLoaded && servers.length === 0) {
    return (
      <WorkspaceShell call={groupCall} className="noServerPage">
        <section>
          <button
            className="workspaceLogo noServerFriendsButton"
            aria-label="Friends"
            onClick={openFriendsHome}
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
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      call={groupCall}
      className={`workspace ${panelClasses}`}
      style={sidebarStyle}
    >
      <aside className="workspaceRail" aria-label="Workspaces">
        <button
          className="workspaceLogo"
          aria-label="Friends"
          onClick={openFriendsHome}
        >
          LC
          {notificationCount > 0 && (
            <span className="notificationBadge">{notificationCount}</span>
          )}
        </button>
        <nav
          className="serverScroller"
          aria-label="Servers"
          style={{ height: Math.max(0, servers.length * 60 - 6) }}
        >
          {servers.map((server) => (
            <div
              className="serverButtonWrap"
              key={server.id}
              onPointerEnter={(event) =>
                event.currentTarget.style.setProperty(
                  "--server-tooltip-top",
                  `${event.currentTarget.getBoundingClientRect().top + 23}px`,
                )
              }
            >
              <button
                className={`workspaceButton ${server.id === selectedServerId ? "active" : ""}`}
                aria-label={server.name}
                title={server.name}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setServerContext({
                    server,
                    x: Math.min(event.clientX, window.innerWidth - 200),
                    y: Math.min(event.clientY, window.innerHeight - 64),
                  });
                }}
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
        </nav>
        {session.user.role !== "demo" && (
          <div
            className="serverButtonWrap addServerButton"
            onPointerEnter={(event) =>
              event.currentTarget.style.setProperty(
                "--server-tooltip-top",
                `${event.currentTarget.getBoundingClientRect().top + 23}px`,
              )
            }
          >
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
            >
              <button
                className="accountMenuTrigger"
                aria-label="Server settings"
                aria-haspopup="dialog"
                title="Server settings"
                aria-expanded={serverSettingsOpen}
                onClick={() => {
                  setServerSettingsSection("overview");
                  setFormName("");
                  setServerFriendSearch("");
                  setSelectedServerFriendIds([]);
                  setServerSettingsOpen((current) => !current);
                }}
              >
                <SettingsIcon />
              </button>
            </div>
          )}
        </header>
        <nav>
          <p className="sectionLabel">TEXT CHANNELS</p>
          {channels
            .filter((channel) => channel.type === "text")
            .map((channel) => (
              <div
                className="channelRow"
                key={channel.id}
                onContextMenu={(event) => openChannelContext(event, channel)}
              >
                <button
                  className={`channel ${!callViewOpen && channel.id === selectedChannelId ? "active" : ""}`}
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
              </div>
            ))}
          <p className="sectionLabel">VOICE CHANNELS</p>
          {channels
            .filter((channel) => channel.type !== "text")
            .map((channel) => (
              <div
                className="voiceChannel"
                key={channel.id}
                onContextMenu={(event) => {
                  if ((event.target as Element).closest(".voiceParticipant"))
                    return;
                  openChannelContext(event, channel);
                }}
              >
                <button
                  className={`channel ${callViewOpen && channel.id === activeVoiceChannelId ? "active" : ""}`}
                  onClick={() => selectVoiceChannel(channel)}
                >
                  <span className="channelIcon" aria-hidden="true">
                    {channel.type === "voice_group" ? "◉" : "\u{1F50A}"}
                  </span>
                  <span className="channelName" title={channel.name}>
                    {channel.name}
                  </span>
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
                        className={`voiceParticipant ${channel.id === activeVoiceChannelId && participant.speaking ? "speaking" : ""}`}
                        key={
                          participant.userId ?? `${participant.name}-${index}`
                        }
                        onContextMenu={(event) => {
                          if (
                            !isSelectedServerOwner ||
                            !participant.userId ||
                            participant.userId === session.user.id
                          )
                            return;
                          event.preventDefault();
                          setVoiceMenu({
                            userId: participant.userId,
                            name: participant.name,
                            channelId: channel.id,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                      >
                        <button
                          className="voiceParticipantIdentity"
                          type="button"
                          disabled={!participant.userId}
                          onClick={() =>
                            participant.userId &&
                            setProfileUser({
                              id: participant.userId,
                              name: participant.name,
                            })
                          }
                        >
                          <i>{participant.name[0]?.toUpperCase()}</i>
                          <b>{participant.name}</b>
                        </button>
                        <em className="voiceIndicators">
                          {participant.muted && (
                            <span title="Muted">
                              <MediaIcon kind="microphone" crossedOut />
                            </span>
                          )}
                          {participant.camera && (
                            <button
                              className="participantMediaOpen"
                              title="Open media view"
                              onClick={() => {
                                if (activeVoiceChannelId !== channel.id)
                                  selectVoiceChannel(channel);
                                setCallViewOpen(true);
                              }}
                            >
                              <MediaIcon kind="camera" crossedOut={false} />
                            </button>
                          )}
                          {participant.screen && (
                            <button
                              className="participantMediaOpen"
                              title="Open shared screen"
                              onClick={() => {
                                if (activeVoiceChannelId !== channel.id)
                                  selectVoiceChannel(channel);
                                setCallViewOpen(true);
                              }}
                            >
                              <MediaIcon kind="screen" crossedOut={false} />
                            </button>
                          )}
                        </em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
        </nav>
        {profilePanel}
        {sidebarResizer}
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
                className={`videoCard ${screenSharing ? "screenShare" : cameraOff ? "nameOnly" : ""} ${hiddenDirectTiles.includes(localDirectTileId) || (focusedDirectVideo && focusedDirectVideo !== "local") ? "videoHidden" : ""}`}
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
                <HideTileButton
                  label={directLocalLabel}
                  onHide={() => hideDirectTile(localDirectTileId)}
                />
                <span>
                  {session.user.name ?? "You"}
                  {screenSharing ? " — screen" : ""}
                </span>
                {localVideoQuality && (screenSharing || !cameraOff) && (
                  <small className="qualityBadge">{localVideoQuality}</small>
                )}
              </div>
              <div
                className={`videoCard remote ${remoteScreenSharing ? "screenShare" : !remoteHasVideo ? "nameOnly" : ""} ${!callPeerPresent || hiddenDirectTiles.includes(remoteDirectTileId) || (focusedDirectVideo && focusedDirectVideo !== "remote") ? "videoHidden" : ""}`}
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
                <HideTileButton
                  label={directRemoteLabel}
                  onHide={() => hideDirectTile(remoteDirectTileId)}
                />
                <span>
                  {directRemoteName}
                  {remoteScreenSharing ? " — screen" : ""}
                </span>
                {remoteVideoQuality && remoteHasVideo && (
                  <small className="qualityBadge">{remoteVideoQuality}</small>
                )}
              </div>
              <div className="callVisibilityControls">
                {directSelfViewButton}
                {directHiddenMenu}
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
            <div className="controls voiceDock" aria-busy={!voiceReady}>
              {audioPlaybackBlocked && (
                <button type="button" onClick={() => void playRemoteAudio()}>
                  Enable sound
                </button>
              )}
              <DeviceMenu
                kind="microphone"
                actionUnavailable={deafened}
                extraOptions={audioDeviceOptions}
                unavailable={!voiceReady}
                disabled={muted}
                devices={microphones}
                selectedId={microphoneId}
                onAction={toggleAudio}
                onRestart={() => void changeActiveMicrophone(microphoneId)}
                onSelect={(deviceId) => void changeActiveMicrophone(deviceId)}
              />
              <DeviceMenu
                kind="camera"
                unavailable={!voiceReady}
                disabled={cameraOff}
                devices={cameras}
                selectedId={cameraId}
                onAction={() => void toggleVideo()}
                onSelect={(deviceId) => void changeActiveCamera(deviceId)}
              />
              <button
                className={screenSharing ? "stopSharing" : ""}
                disabled={!voiceReady}
                onClick={() => void toggleScreenShare()}
              >
                {screenSharing ? "Stop sharing" : "Share screen"}
              </button>
              <button
                className="soundboardPlaceholder"
                disabled
                title="Soundboard — coming soon"
              >
                Soundboard
              </button>
            </div>
            {mediaNotice && <p className="mediaNotice">{mediaNotice}</p>}
          </section>
        )}
        {selectedChannel?.type === "text" && !callViewOpen && (
          <section className="chat">
            <ChatHistory
              key={selectedChannelId}
              threadId={selectedChannelId}
              messages={messages}
              ready={channelHistoryLoaded === selectedChannelId}
              hasMore={Boolean(nextMessageCursor)}
              loadingOlder={loadingMoreMessages}
              onLoadOlder={loadMoreMessages}
              ownUserId={session.user.id}
            >
              {channelHistoryLoaded === selectedChannelId &&
                messages.length === 0 && (
                  <p className="empty">
                    {selectedChannelId
                      ? "This channel has no messages yet."
                      : "Create or select a channel to begin."}
                  </p>
                )}
              {messages.map((message) => (
                <article
                  className={`${message.authorId === session.user.id ? "messageOwn" : "messageOther"} ${message.deleted ? "deletedMessage" : ""}`}
                  key={message.id}
                  data-message-id={message.id}
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
                  <MessageHeader
                    name={message.author}
                    time={message.time}
                    onProfile={() =>
                      setProfileUser({
                        id: message.authorId,
                        name: message.author,
                        ...friends.find(
                          (friend) => friend.id === message.authorId,
                        ),
                      })
                    }
                  />
                  <p>{message.text}</p>
                </article>
              ))}
            </ChatHistory>
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
            <button
              type="button"
              className="member online"
              data-status={userStatuses[member.id] ?? "online"}
              key={member.id}
              onClick={() => setProfileUser(member)}
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
                <strong>{member.name}</strong>
                <small>
                  {statusLabels[userStatuses[member.id] ?? "online"]} ·{" "}
                  {member.role}
                </small>
              </span>
            </button>
          ))}
          <p className="sectionLabel">OFFLINE — {offlineMembers.length}</p>
          {offlineMembers.map((member) => (
            <button
              type="button"
              className="member offline"
              key={member.id}
              onClick={() => setProfileUser(member)}
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
                <strong>{member.name}</strong>
                <small>{member.role}</small>
              </span>
            </button>
          ))}
        </div>
        {legalLinks}
      </aside>
      {legalOverlay}
      {settingsOverlay}
      {profileOverlay}
      {serverContextMenu}
      {channelContextMenu}
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
      {voiceMenu && (
        <div
          className="messageContextMenu"
          ref={memberContextMenu}
          role="menu"
          style={{ left: voiceMenu.x, top: voiceMenu.y }}
        >
          <button
            className="danger"
            type="button"
            role="menuitem"
            onClick={() => {
              void kickVoiceParticipant(voiceMenu.userId, voiceMenu.channelId);
              setVoiceMenu(null);
            }}
          >
            Kick {voiceMenu.name} from voice
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
          {messageMenu.message.authorId === session.user.id && (
            <button
              className="danger"
              type="button"
              role="menuitem"
              onClick={() =>
                requestMessageDeletion(
                  messageMenu.message.id,
                  messageMenu.message.text,
                  undefined,
                  messageMenu.message.deleted,
                )
              }
            >
              {messageMenu.message.deleted
                ? "Delete permanently"
                : "Delete message"}
            </button>
          )}
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
                    : form === "messages"
                      ? "Account messages"
                      : "Manage demo accounts"}
            </h2>
            {form !== "manage" && form !== "messages" && (
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
            {form === "messages" && accountMessagesContent}
            <div className="modalActions">
              <button type="button" onClick={closeCurrentForm}>
                {form === "manage" || form === "messages"
                  ? form === "messages" && returnToDemoManager
                    ? "Back"
                    : "Close"
                  : "Cancel"}
              </button>
              {form !== "manage" && form !== "messages" && (
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
      {deleteMessageCandidate &&
        !deleteMessageCandidate.conversationUserId &&
        !accountMenuOpen && (
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
              <h2 id="delete-message-title">
                {deleteMessageCandidate.alreadyDeleted
                  ? "Remove deleted message?"
                  : "Delete message?"}
              </h2>
              <p>
                {deleteMessageCandidate.alreadyDeleted ? (
                  "This permanently removes the deleted-message placeholder. Existing replies will remain, without a link to this message. This cannot be undone."
                ) : (
                  <>
                    By default, LC erases the content but keeps a{" "}
                    <em>Deleted message</em> placeholder so existing replies
                    still make sense.
                  </>
                )}
              </p>
              <blockquote>{deleteMessageCandidate.preview}</blockquote>
              <label className="permanentDeleteOption">
                <input
                  type="checkbox"
                  checked={permanentMessageDeletion}
                  disabled={deleteMessageCandidate?.alreadyDeleted}
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
    </WorkspaceShell>
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
  return new WebSocket(
    `${url}${separator}token=${encodeURIComponent(token)}&status=${encodeURIComponent(readUserStatus())}`,
  );
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
  const [hovered, setHovered] = useState(false);
  const [position, setPosition] = useState({
    left: 16,
    bottom: 0,
    maxHeight: 400,
  });
  const tooltipId = useId();
  const anchor = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - 32);
    setPosition({
      left: Math.max(
        16,
        Math.min(rect.right - width, window.innerWidth - width - 16),
      ),
      bottom: window.innerHeight - rect.top + 10,
      maxHeight: Math.max(100, rect.top - 26),
    });
  };
  useEffect(() => {
    if (!open && !hovered) return;
    const close = (event: Event) => {
      if (
        event.type === "scroll" &&
        event.target instanceof Element &&
        event.target.closest(".diagnosticsTooltip")
      )
        return;
      setOpen(false);
      setHovered(false);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, hovered]);
  return (
    <span
      className="diagnosticsAnchor"
      onPointerLeave={() => setHovered(false)}
    >
      <button
        type="button"
        className="diagnosticsIndicator"
        aria-expanded={open}
        aria-describedby={open || hovered ? tooltipId : undefined}
        aria-label="Call diagnostics"
        onPointerEnter={(event) => {
          anchor(event.currentTarget);
          setHovered(true);
        }}
        onFocus={(event) => {
          anchor(event.currentTarget);
          setHovered(true);
        }}
        onClick={(event) => {
          event.stopPropagation();
          anchor(event.currentTarget);
          setOpen((current) => !current);
        }}
        onBlur={() => {
          setOpen(false);
          setHovered(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setHovered(false);
            event.currentTarget.blur();
          }
        }}
      >
        i
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`diagnosticsTooltip ${open || hovered ? "open" : ""}`}
        style={{
          left: position.left,
          top: "auto",
          bottom: position.bottom,
          maxHeight: position.maxHeight,
        }}
      >
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
