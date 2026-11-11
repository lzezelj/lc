"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { signOut, useSession } from "next-auth/react";
import {
  playVoiceSound,
  prepareVoiceSounds,
  playNotificationSound,
} from "./call-sounds";
import { NotificationSoundGate } from "./notification-sounds";
import { VoiceParticipantMenu } from "./voice-participant-menu";
import { HelpTour } from "./help-tour";
import { LoadingSkeleton } from "./loading-skeleton";
import { DeviceMenu, MediaDeviceOption } from "./device-menu";
import {
  ParticipantMediaIndicators,
  SoundboardIndicator,
} from "./participant-media-indicators";
import { PanelToggle } from "./panel-toggle";
import { DeviceSelection } from "./device-selection";
import { GroupCall } from "./group-call";
import { WorkspaceShell } from "./workspace-shell";
import { WorkspaceLinks } from "./workspace-links";
import { VoiceTransferDialog } from "./voice-transfer-dialog";
import {
  HideTileButton,
  HiddenTilesMenu,
  SelfViewButton,
} from "./call-tile-controls";
import { useCallAudio, useScreenAudio, useSoundboardAudio } from "./call-media";
import { SoundboardButton, useSoundboard } from "./soundboard";
import { takeVoiceToggle } from "./voice-toggle-cooldown";
import { useIdlePresence } from "./use-idle-presence";
import { CameraMirrorControl } from "./camera-mirror";
import { captureCamera, cameraSource } from "./camera-processing";
import { ServerAfkSettings } from "./server-afk-settings";
import { sharedAudioCapture, preferSharedAudio } from "./shared-audio";
import { StreamVolume } from "./stream-volume";
import {
  CameraResolutionSelection,
  cameraCaptureConstraints,
  readCameraResolution,
  readCameraFrameRate,
  videoPublishEncoding,
  type VideoFrameRate,
  type CameraResolution,
} from "./camera-resolution";
import { reserveScreenAudio } from "./screen-audio";
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
import { useDragReorder, ReorderHandle, ReorderStatus } from "./drag-reorder";
import type { DropPlacement } from "../lib/list-order";
import { ChatHistory } from "./chat-history";
import { ConversationSearch, type SearchMessage } from "./conversation-search";
import {
  applyMessageEdit,
  applyMessageRemoval,
  type MessageEdit,
} from "./message-updates";
import { MessageComposer, sendMessageRequest } from "./message-composer";
import { MessageReactions, MessageReactionMenu } from "./message-reactions";
import { useMessageReactions } from "./use-message-reactions";
import { useTyping } from "./use-typing";
import { MessageAttachments } from "./message-attachments";
import { useConversationDraft } from "./use-conversation-draft";
import {
  readHistoryWindow,
  reconcileRecoveredHistory,
} from "./history-recovery";
import {
  messageDeletionPreview,
  type MessageAttachment,
} from "./attachment-types";
import { ServerInvites } from "./server-invites";
import { ServerLeaveConfirmation } from "./server-leave-confirmation";
import { useServerInvitations } from "./use-server-invitations";
import { PendingServerInvitations } from "./pending-server-invitations";
import { PersonalMessages } from "./personal-messages";
import { AccountDeletion } from "./account-deletion";
import { SettingsMembers } from "./settings-members";
import { SettingsNavigation } from "./settings-navigation";
import { SoundManager } from "./sound-manager";
import { useWorkspaceActivity } from "./use-workspace-activity";
import { serverVoiceUsers } from "./workspace-activity";
import { ServerNavButton, preloadServerPictures } from "./server-nav-button";
import { UnreadIndicator } from "./unread-indicator";
import { MentionText } from "./mention-text";
import {
  NotificationSettings,
  NotificationMuteMenu,
  type NotificationTarget,
} from "./notification-settings";
import { useNotificationInbox } from "./use-notification-inbox";
import type { Mention } from "./notification-types";
import {
  friendCallRoom,
  isFriendCall,
  conversationHasCall,
  incomingCallMatches,
  type IncomingCall,
} from "./call-context";
import { IncomingCallNotice } from "./incoming-call-notice";
import {
  StreamInfo,
  fullscreenVideoTile,
  directionalStreamStats,
} from "./stream-info";
import { EmptyState } from "./empty-state";
import {
  ScreenShareOptions,
  screenShareResolutions,
  type ScreenShareResolution,
} from "./screen-share-options";
import { useMessageCooldown } from "./use-message-cooldown";
import { MessageHeader } from "./message-header";
import { Avatar } from "./avatar";
import { LegalFrame } from "./legal-frame";
import { StatusAvatar } from "./status-avatar";
import {
  alphabeticalParticipants,
  showParticipantSpeaking,
} from "./voice-participants";
import { LocallyMuted } from "./locally-muted";
import { ProfilePictureSettings } from "./profile-picture-settings";
import {
  useParticipantAudio,
  ParticipantAudioControls,
} from "./participant-audio";
import { participantGain } from "./remote-audio-volume";
import { createAudioTransmissionGate } from "./audio-transmission";
import {
  voiceBlocked,
  type VoicePolicy,
  type VoicePolicies,
} from "./voice-policy";
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
import { ConversationCache, SessionCache } from "./conversation-cache";
import {
  microphoneProcessing,
  monitorVoiceActivity,
  prepareVoiceActivity,
} from "./voice-activity";

type ChatMessage = {
  id: string;
  authorId: string;
  author: string;
  authorImage?: string | null;
  text: string;
  time: string;
  deleted: boolean;
  replyTo: { id: string; text: string; author: string } | null;
  kind: "message" | "call";
  callDurationSeconds: number | null;
  attachments?: MessageAttachment[];
  editedAt?: string | null;
  editedByAdmin?: boolean;
  mentions?: Mention[];
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

type Server = {
  afkChannelId?: string | null;
  image?: string | null;
  voiceMuted?: boolean;
  voiceDeafened?: boolean;
  id: string;
  name: string;
  role?: "owner" | "member" | "mod";
  joinSoundId?: string | null;
};
type Friend = {
  id: string;
  name: string;
  handle: string;
  image: string | null;
  status: "pending" | "accepted";
  incoming: boolean;
  lastActivityAt: string | null;
  lastMessage?: { senderId: string; text: string } | null;
};
type ChannelType = "text" | "voice_direct" | "voice_group";
type Channel = {
  id: string;
  name: string;
  type: ChannelType;
  serverId?: string;
  serverName?: string;
};
type Member = {
  canBeModerator?: boolean;
  voiceMuted?: boolean;
  voiceDeafened?: boolean;
  id: string;
  name: string;
  handle?: string | null;
  image: string | null;
  role: "owner" | "member" | "mod";
};
type VoiceParticipant = {
  soundboard?: boolean;
  connecting?: boolean;
  userId?: string;
  name: string;
  muted: boolean;
  deafened?: boolean;
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
  notification?: string;
  reason?: string;
  serverName?: string;
  automatic?: boolean;
  soundboard?: boolean;
  notice?: string;
  name?: string;
  invitationId?: string;
  voiceMuted?: boolean;
  voiceDeafened?: boolean;
  image?: string | null;
  joinSoundId?: string | null;
  userId?: string;
  author?: string;
  sessionId?: string;
  channel?: Channel;
  authorId?: string;
  createdAt?: string;
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
  edit?: MessageEdit;
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

function formatCallDuration(seconds: number | null) {
  const total = Math.max(0, seconds ?? 0);
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

export default function Home() {
  const remoteAudio = useCallAudio();
  const remoteScreenAudio = useScreenAudio();
  const screenAudioSender = useRef<RTCRtpSender | null>(null);
  const soundboardSender = useRef<RTCRtpSender | null>(null);
  const pendingJoinAnnouncement = useRef(false);
  const remoteSoundboardAudio = useSoundboardAudio();
  const stopScreenAudioSlot = useRef<(() => void) | null>(null);
  const remoteSharing = useRef(false);
  const [streamVolume, setStreamVolume] = useState(100);
  const [cameraResolution, setCameraResolution] =
    useState(readCameraResolution);
  const [cameraFrameRate, setCameraFrameRate] = useState(readCameraFrameRate);
  const [mediaFocusTarget, setMediaFocusTarget] = useState<{
    userId: string;
    kind: "camera" | "screen";
    requestId: number;
  } | null>(null);
  const sessionState = useSession();
  const session = sessionState.data;
  const participantAudio = useParticipantAudio(session?.user.id);
  function userImage(id?: string, fallback?: string | null) {
    if (id === session?.user.id) return session?.user.image;
    const known =
      friends.find((person) => person.id === id) ??
      members.find((person) => person.id === id);
    return known ? known.image : fallback;
  }
  const conversationCache = useRef(new ConversationCache<ChatMessage>());
  function applyProfilePicture(userId: string, image: string | null) {
    setFriends((people) =>
      people.map((person) =>
        person.id === userId ? { ...person, image } : person,
      ),
    );
    setMembers((people) =>
      people.map((person) =>
        person.id === userId ? { ...person, image } : person,
      ),
    );
    setProfileUser((person) =>
      person?.id === userId ? { ...person, image } : person,
    );
    serverViewCache.current.clear();
  }
  const serverViewCache = useRef(
    new SessionCache<{ channels?: Channel[]; members?: Member[] }>(
      1024 * 1024,
      20,
    ),
  );
  const presenceHasConnected = useRef(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  useEffect(() => {
    conversationCache.current.scope(session?.user.id);
    serverViewCache.current.scope(session?.user.id);
    presenceHasConnected.current = false;
  }, [session?.user.id]);
  const sessionStatus: string = sessionState.status;
  const updateSession = sessionState.update;
  const updateSessionRef = useRef(updateSession);
  useEffect(() => {
    updateSessionRef.current = updateSession;
  }, [updateSession]);
  // Auth.js retains the current session while update() refreshes it. Keep the
  // workspace and presence mounted through that temporary loading state.
  const authStatus =
    session?.user.id && sessionStatus === "loading"
      ? "authenticated"
      : sessionStatus;
  const [servers, setServers] = useState<Server[]>([]);
  const serverOrderRequest = useRef(0);
  const channelOrderRequests = useRef(new Map<string, number>());
  const orderRefreshHandlers = useRef<{
    servers: () => Promise<void>;
    channels: (serverId: string) => Promise<void>;
  }>({ servers: async () => {}, channels: async () => {} });
  useEffect(() => {
    orderRefreshHandlers.current = {
      servers: refreshServerOrder,
      channels: refreshChannelOrder,
    };
  });
  useEffect(() => {
    if (!session?.user.id) return;
    const refresh = () => {
      void orderRefreshHandlers.current.servers().catch(() => undefined);
      if (selectedServerIdRef.current)
        void orderRefreshHandlers.current
          .channels(selectedServerIdRef.current)
          .catch(() => undefined);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [session?.user.id]);
  const invitationAccount = useRef(session?.user.id);
  const kickedServers = useRef(new Set<string>());
  useEffect(() => {
    invitationAccount.current = session?.user.id;
  }, [session?.user.id]);
  const serverInvitations = useServerInvitations(
    session?.user.id,
    (serverId, userId) => {
      serverViewCache.current.delete(session?.user.id, serverId);
      if (userId === session?.user.id) {
        kickedServers.current.delete(serverId);
        invalidateSignalingToken();
        void fetch("/api/servers")
          .then(async (response) => {
            const data = response.ok ? await response.json() : null;
            if (data && invitationAccount.current === session?.user.id)
              setServers(data);
          })
          .catch(() =>
            setErrorMessage(
              "Server access changed, but the server list could not be refreshed.",
            ),
          );
        setSignalingRefreshKey((current) => current + 1);
      } else if (selectedServerIdRef.current === serverId) {
        void fetch(`/api/servers/${serverId}/members`)
          .then(async (response) => {
            const data = response.ok ? await response.json() : null;
            if (
              data &&
              selectedServerIdRef.current === serverId &&
              invitationAccount.current === session?.user.id
            )
              setMembers(data);
          })
          .catch(() => {});
      }
    },
  );
  const [voicePolicies, setVoicePolicies] = useState<
    Record<string, VoicePolicies>
  >({});
  const applyVoiceModeration = useCallback(
    (serverId: string, userId: string, policy: VoicePolicy) => {
      setVoicePolicies((current) => ({
        ...current,
        [`${session?.user.id}:${serverId}`]: {
          ...current[`${session?.user.id}:${serverId}`],
          [userId]: policy,
        },
      }));
      if (userId === session?.user.id)
        setServers((current) =>
          current.map((server) =>
            server.id === serverId ? { ...server, ...policy } : server,
          ),
        );
      if (selectedServerIdRef.current === serverId)
        setMembers((current) =>
          current.map((member) =>
            member.id === userId ? { ...member, ...policy } : member,
          ),
        );
      serverViewCache.current.delete(session?.user.id, serverId);
      window.dispatchEvent(
        new CustomEvent("lc-voice-moderation", {
          detail: { serverId, userId, ...policy },
        }),
      );
    },
    [session?.user.id],
  );
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
  const directHistoryCacheable = useRef("");
  const [channelHistoryLoaded, setChannelHistoryLoaded] = useState("");
  const [readableHistoryChannel, setReadableHistoryChannel] = useState("");
  const channelHistoryGeneration = useRef(0);
  const channelHistoryCacheable = useRef("");
  const [unreadDirectMessages, setUnreadDirectMessages] = useState<
    Record<string, number>
  >({});
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [callPeerPresent, setCallPeerPresent] = useState(false);
  const [signalingRefreshKey, setSignalingRefreshKey] = useState(0);
  const [serversLoaded, setServersLoaded] = useState(false);
  const [helpRequest, setHelpRequest] = useState(0);
  const helpPreviousView = useRef<{
    friends: boolean;
    friend: Friend | null;
    callView: boolean;
    serverId: string;
    channelId: string;
  } | null>(null);
  const [navigationReady, setNavigationReady] = useState(false);
  const pendingLocation = useRef<WorkspaceLocation | null>(null);
  const locationUser = useRef("");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [serverChannelsLoaded, setServerChannelsLoaded] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [userStatus, setUserStatus] = useState<UserStatus>(readUserStatus);
  const [automaticAway, setAutomaticAway] = useState(false);
  const [createAfk, setCreateAfk] = useState(false);
  const notificationsEnabled = userStatus !== "dnd";
  const [userStatuses, setUserStatuses] = useState<Record<string, UserStatus>>(
    {},
  );
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [form, setForm] = useState<"server" | "channel" | null>(null);
  const [formName, setFormName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("text");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [serverListToggled, setServerListToggled] = useState(false);
  const [channelsHidden, setChannelsHidden] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = Number(localStorage.getItem("lc.sidebarWidth"));
    return Number.isFinite(saved) && saved >= 240 && saved <= 480
      ? Math.max(320, saved)
      : null;
  });
  const [memberSidebarWidth, setMemberSidebarWidth] = useState<number | null>(
    () => {
      if (typeof window === "undefined") return null;
      const saved = Number(localStorage.getItem("lc.memberSidebarWidth"));
      return Number.isFinite(saved) && saved >= 240 && saved <= 480
        ? saved
        : null;
    },
  );
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
  const [notificationTarget, setNotificationTarget] =
    useState<NotificationTarget | null>(null);
  const closeNotificationMute = useCallback(
    () => setNotificationTarget(null),
    [],
  );
  function openNotificationMute(
    event: { clientX: number; clientY: number; preventDefault: () => void },
    scope: "server" | "direct",
    item: { id: string; name: string },
  ) {
    event.preventDefault();
    setNotificationTarget({
      scope,
      ...item,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 368)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 320)),
    });
  }
  const [channelContext, setChannelContext] = useState<{
    channel: Channel;
    x: number;
    y: number;
  } | null>(null);
  const channelContextRef = useRef<HTMLDivElement>(null);
  const [deleteServerOpen, setDeleteServerOpen] = useState(false);
  const [leaveServerTarget, setLeaveServerTarget] = useState<Server | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextMessageCursor, setNextMessageCursor] = useState<{
    beforeCreatedAt: string;
    beforeId: string;
  } | null>(null);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [messageMenu, setMessageMenu] = useState<{
    message: ChatMessage;
    conversationUserId?: string;
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
  const composerKey = `${session?.user.id}:${friendsView ? `direct:${selectedFriend?.id}` : `channel:${selectedChannelId}`}`;
  const {
    text: draft,
    files,
    setText: setDraft,
    setFiles: changeFiles,
    clearSent,
  } = useConversationDraft(
    session?.user.id,
    friendsView
      ? selectedFriend
        ? `direct:${selectedFriend.id}`
        : undefined
      : selectedChannelId
        ? `channel:${selectedChannelId}`
        : undefined,
  );
  const [historyAtLatest, setHistoryAtLatest] = useState({
    key: "",
    visible: false,
  });
  const historyVisibilityRef = useRef({ key: "", visible: false });
  function updateLatestVisibility(visible: boolean) {
    historyVisibilityRef.current = { key: composerKey, visible };
    setHistoryAtLatest((current) =>
      current.key === composerKey && current.visible === visible
        ? current
        : { key: composerKey, visible },
    );
  }
  const [editingMessage, setEditingMessage] = useState<{
    key: string;
    message: ChatMessage;
    userId?: string;
    channelId?: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const activeEdit =
    editingMessage?.key === composerKey ? editingMessage : null;
  const [historyContext, setHistoryContext] = useState<{
    key: string;
    targetId: string;
    messages: ChatMessage[];
  } | null>(null);
  const activeContext =
    historyContext?.key === composerKey ? historyContext : null;
  useEffect(() => {
    void Promise.resolve().then(() => setHistoryContext(null));
  }, [historyRefreshKey]);
  const shownDirectMessages = activeContext?.messages ?? directMessages;
  const shownChannelMessages = activeContext?.messages ?? messages;
  const channelReactions = useMessageReactions(
    session?.user.id,
    { channelId: !friendsView ? selectedChannelId : undefined },
    !friendsView
      ? shownChannelMessages
          .filter((message) => !message.deleted)
          .map((message) => message.id)
      : [],
  );
  const directReactions = useMessageReactions(
    session?.user.id,
    { userId: friendsView ? selectedFriend?.id : undefined },
    friendsView && selectedFriend
      ? shownDirectMessages
          .filter((message) => !message.deleted && message.kind !== "call")
          .map((message) => message.id)
      : [],
  );
  function showSearchResult(rows: SearchMessage[], targetId: string) {
    setHistoryContext({
      key: composerKey,
      targetId,
      messages: rows.map(toChatMessage),
    });
  }
  function updateContext(edit: MessageEdit, key: string) {
    setHistoryContext((current) =>
      current?.key === key
        ? { ...current, messages: applyMessageEdit(current.messages, edit) }
        : current,
    );
  }
  const [sendingMessage, setSendingMessage] = useState(false);
  const sendingMessageRef = useRef(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [status, setStatus] = useState("Not connected");
  const [joined, setJoined] = useState(false);
  const [joining, setJoining] = useState(false);
  const [mediaNotice, setMediaNotice] = useState("");
  const [microphoneMuted, setMuted] = useState(false);
  const [userDeafened, setDeafened] = useState(false);
  const [activeVoiceChannelId, setActiveVoiceChannelId] = useState("");
  const [activeVoiceChannelSnapshot, setActiveVoiceChannelSnapshot] =
    useState<Channel | null>(null);
  const activeVoiceServerRef = useRef("");
  activeVoiceServerRef.current = activeVoiceChannelSnapshot?.serverId ?? "";
  const ownVoicePolicy =
    voicePolicies[
      `${session?.user.id}:${activeVoiceChannelSnapshot?.serverId}`
    ]?.[session?.user.id ?? ""] ??
    servers.find(
      (server) => server.id === activeVoiceChannelSnapshot?.serverId,
    );
  const deafened = userDeafened || Boolean(ownVoicePolicy?.voiceDeafened);
  const deafenedRef = useRef(deafened);
  const groupMediaRef = useRef<{
    microphoneSpeaking?: boolean;
    soundboard?: boolean;
    muted: boolean;
    camera: boolean;
    screen: boolean;
    speaking: boolean;
  }>({
    soundboard: false,
    muted: false,
    camera: false,
    screen: false,
    speaking: false,
  });
  const muted =
    microphoneMuted || deafened || Boolean(ownVoicePolicy?.voiceMuted);
  const effectiveMutedRef = useRef(muted);
  useEffect(() => {
    effectiveMutedRef.current = muted;
    deafenedRef.current = deafened;
  }, [muted, deafened]);
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
  useEffect(() => {
    const active = socket.current;
    if (joined && active?.readyState === WebSocket.OPEN)
      active.send(
        JSON.stringify({
          type: "media-state",
          muted,
          deafened,
          camera: !cameraOff,
          screen: screenSharing,
          speaking: false,
        }),
      );
  }, [joined, muted, deafened, cameraOff, screenSharing]);
  const [voicePresence, setVoicePresence] = useState<
    Record<string, VoiceParticipant[]>
  >({});
  const authoritativePresenceChannels = useRef(new Set<string>());
  const [errorMessage, setErrorMessage] = useState("");
  const [screenShareOptionsOpen, setScreenShareOptionsOpen] = useState(false);
  const messageCooldown = useMessageCooldown();
  const [noticeMessage, setNoticeMessage] = useState("");
  const [legalDocument, setLegalDocument] = useState<
    "impressum" | "privacy" | "licenses" | null
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
  const [mediaPermissionsGranted, setMediaPermissionsGranted] = useState(false);
  const [voiceJoinKey, setVoiceJoinKey] = useState(0);
  const voiceSessionId = useRef("");
  const disconnectedVoiceSessionId = useRef("");
  const [voiceTransferOpen, setVoiceTransferOpen] = useState(false);
  const [voiceJoinTarget, setVoiceJoinTarget] = useState("");
  const directSoundSpeaking = useRef(false);
  const directSoundPlaying = useRef(false);
  const directMicSpeaking = useRef(false);
  const soundboard = useSoundboard(activeVoiceChannelId, {
    onPlayingChange: (playing) => {
      directSoundPlaying.current = playing;
      updateDirectSpeaking();
    },
    microphoneMuted: muted,
    serverId: activeVoiceChannelSnapshot?.serverId,
    outputVolume,
    outputId,
    deafened,
    onSpeakingChange: (speaking) => {
      directSoundSpeaking.current = speaking;
      updateDirectSpeaking();
    },
  });
  const soundPlayerRef = soundboard.player;
  const activeVoiceChannelRef = useRef("");
  const pendingVoiceChannel = useRef("");
  activeVoiceChannelRef.current = activeVoiceChannelId;
  const [connectedGroupChannelId, setConnectedGroupChannelId] = useState("");
  const [callViewOpen, setCallViewOpen] = useState(false);
  const [hiddenDirectTiles, setHiddenDirectTiles] = useState<string[]>([
    "local",
    "local-screen",
  ]);
  const [renameTarget, setRenameTarget] = useState<{
    kind: "user" | "server" | "channel";
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
  const recordIdleActivity = useIdlePresence(session?.user.id, {
    status: userStatus,
    automaticAway,
    isSpeaking: () =>
      directMicSpeaking.current ||
      Boolean(
        activeGroupChannelId.current &&
        groupMediaRef.current.microphoneSpeaking,
      ),
    onStatus: changePresenceStatus,
    onAfk: () => {
      const current = activeVoiceChannelSnapshot;
      const destinationId = servers.find(
        (server) => server.id === current?.serverId,
      )?.afkChannelId;
      if (!current?.serverId || !destinationId || current.id === destinationId)
        return;
      void fetch(`/api/servers/${current.serverId}/voice-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: session?.user.id,
          channelId: current.id,
          destinationId,
          afk: true,
        }),
      }).catch(() => {});
    },
  });
  function changePresenceStatus(status: UserStatus, automatic = false) {
    localStorage.setItem("lc.userStatus", automatic ? "online" : status);
    setUserStatus(status);
    setAutomaticAway(automatic);
    if (presenceSocket.current?.readyState === WebSocket.OPEN)
      presenceSocket.current.send(
        JSON.stringify({ type: "set-user-status", status, automatic }),
      );
  }
  const typing = useTyping(
    presenceSocket,
    session?.user.id,
    friendsView
      ? { userId: selectedFriend?.id }
      : { channelId: selectedChannelId },
  );
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
  const messageContextMenu = useRef<HTMLDivElement>(null);
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
  const moveVoiceRef = useRef<(message: Signal) => void>(() => undefined);
  useEffect(() => {
    moveVoiceRef.current = (message) => {
      if (
        message.roomId !== activeVoiceChannelRef.current ||
        !message.channel ||
        message.channel.type === "text"
      )
        return;
      selectVoiceChannel(message.channel);
      setNoticeMessage(`You were moved to ${message.channel.name}.`);
    };
  });
  const stopSpeechMonitor = useRef<(() => void) | null>(null);
  const stopRemoteSpeechMonitor = useRef<(() => void) | null>(null);
  const stopDirectStats = useRef<(() => void) | null>(null);
  const canReadConversation =
    historyAtLatest.key === composerKey &&
    historyAtLatest.visible &&
    !activeContext &&
    !accountMenuOpen &&
    !serverSettingsOpen &&
    !legalDocument &&
    !profileUser &&
    !form &&
    (!callViewOpen ||
      (friendsView &&
        conversationHasCall(
          activeVoiceChannelId,
          session?.user.id,
          selectedFriend?.id,
        )));
  const readMessageId = (friendsView ? directMessages : messages).at(-1)?.id;
  const notificationInbox = useNotificationInbox(
    authStatus === "authenticated" ? session?.user.id : undefined,
    servers
      .map((server) => server.id)
      .sort()
      .join(",") +
      friends
        .map((friend) => `${friend.id}:${friend.status}`)
        .sort()
        .join(","),
    canReadConversation &&
      readMessageId &&
      (friendsView
        ? directHistoryLoaded === selectedFriend?.id
        : channelHistoryLoaded === selectedChannelId)
      ? {
          scope: friendsView ? "direct" : "channel",
          targetId: friendsView ? selectedFriend!.id : selectedChannelId,
          messageId: readMessageId,
          canRead: () =>
            historyVisibilityRef.current.key === composerKey &&
            historyVisibilityRef.current.visible,
        }
      : null,
  );
  const notificationInboxRef = useRef(notificationInbox);
  const notificationSoundGate = useRef(new NotificationSoundGate());
  const notificationPolicyRef = useRef({
    enabled: notificationsEnabled,
    channelId: "",
    outputVolume,
  });
  useEffect(() => {
    notificationInboxRef.current = notificationInbox;
    notificationPolicyRef.current = {
      enabled: notificationsEnabled,
      channelId: canReadConversation && !friendsView ? selectedChannelId : "",
      outputVolume,
    };
  });
  const callsNotificationAllowed =
    !incomingCall ||
    (notificationInbox.ready &&
      notificationInbox.allowed("direct", incomingCall.fromUserId, "calls"));
  const currentChannelStatus = notificationInbox.channels.find(
    (channel) => channel.id === selectedChannelId,
  );
  const currentDirectStatus = notificationInbox.direct.find(
    (friend) => friend.id === selectedFriend?.id,
  );
  const firstUnreadId =
    (friendsView ? currentDirectStatus : currentChannelStatus)?.firstUnreadId ??
    null;
  const [unreadBoundary, setUnreadBoundary] = useState<{
    key: string;
    id: string | null;
    captured: boolean;
  }>({ key: "", id: null, captured: false });
  const conversationUnreadId =
    unreadBoundary.key === composerKey && unreadBoundary.captured
      ? unreadBoundary.id
      : firstUnreadId;
  useEffect(() => {
    if (notificationInbox.ready)
      void Promise.resolve().then(() =>
        setUnreadBoundary((current) =>
          current.key === composerKey && current.captured
            ? current
            : { key: composerKey, id: firstUnreadId, captured: true },
        ),
      );
  }, [composerKey, notificationInbox.ready, firstUnreadId]);
  const workspaceActivity = useWorkspaceActivity(
    authStatus === "authenticated" ? session?.user.id : undefined,
    servers
      .map((server) => server.id)
      .sort()
      .join(","),
    !friendsView &&
      canReadConversation &&
      !callViewOpen &&
      !accountMenuOpen &&
      !serverSettingsOpen &&
      !legalDocument &&
      channelHistoryLoaded === selectedChannelId &&
      readableHistoryChannel === selectedChannelId
      ? selectedChannelId
      : "",
  );
  const workspaceActivityRef = useRef(workspaceActivity);
  useEffect(() => {
    workspaceActivityRef.current = workspaceActivity;
  });
  const unreadServerIds = new Set(
    workspaceActivity.channels
      .filter(() => notificationsEnabled)
      .filter(
        (channel) =>
          (notificationInbox.ready
            ? notificationInbox.channels.some(
                (item) => item.id === channel.id && item.unread,
              )
            : workspaceActivity.unread[channel.id]) &&
          notificationInbox.allowed("server", channel.serverId, "messages"),
      )
      .map((channel) => channel.serverId),
  );
  const channelMentionCounts = Object.fromEntries(
    notificationInbox.channels.map((channel) => [
      channel.id,
      notificationsEnabled &&
      notificationInbox.allowed("server", channel.serverId, "mentions")
        ? channel.mentions
        : 0,
    ]),
  );
  const serverMentionCounts = notificationInbox.channels.reduce<
    Record<string, number>
  >((counts, channel) => {
    counts[channel.serverId] =
      (counts[channel.serverId] ?? 0) + (channelMentionCounts[channel.id] ?? 0);
    return counts;
  }, {});
  const channelUnread = Object.fromEntries(
    workspaceActivity.channels.map((channel) => [
      channel.id,
      notificationsEnabled &&
        notificationInbox.allowed("server", channel.serverId, "messages") &&
        (notificationInbox.ready
          ? notificationInbox.channels.some(
              (item) => item.id === channel.id && item.unread,
            )
          : !!workspaceActivity.unread[channel.id]),
    ]),
  );
  const visibleDirectCounts = notificationInbox.ready
    ? Object.fromEntries(
        notificationInbox.direct.map((friend) => [
          friend.id,
          notificationInbox.allowed("direct", friend.id, "messages")
            ? friend.unread
            : 0,
        ]),
      )
    : unreadDirectMessages;

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

  const directPeerUserId = activeVoiceChannelId.startsWith("friend:")
    ? activeVoiceChannelId
        .slice(7)
        .split(":")
        .find((id) => id !== session?.user.id)
    : voicePresence[activeVoiceChannelId]?.find(
        (person) => person.userId !== session?.user.id,
      )?.userId;
  const directPersonGain = participantGain(
    participantAudio.values,
    directPeerUserId,
  );
  const nativeAudioGate = useRef<ReturnType<
    typeof createAudioTransmissionGate
  > | null>(null);
  const directTransmitBlocked =
    voiceBlocked(ownVoicePolicy) ||
    Boolean(participantAudio.values[directPeerUserId ?? ""]?.deafened) ||
    Boolean(
      voicePolicies[
        `${session?.user.id}:${activeVoiceChannelSnapshot?.serverId}`
      ]?.[directPeerUserId ?? ""]?.voiceDeafened,
    );
  const directTransmitBlockedRef = useRef(directTransmitBlocked);
  useEffect(() => {
    directTransmitBlockedRef.current = directTransmitBlocked;
    void nativeAudioGate.current?.update(directTransmitBlocked);
  }, [directTransmitBlocked]);
  useEffect(() => {
    setMicrophoneDeafened(deafened);
    const audio = remoteAudio.current;
    if (audio)
      void applyCallOutput(
        audio,
        outputVolume * directPersonGain,
        deafened,
        outputId,
      ).catch(() =>
        setErrorMessage(
          "Could not switch the output device. Check browser permissions or select System default.",
        ),
      );
    return () => setMicrophoneDeafened(false);
  }, [deafened, outputVolume, outputId, remoteAudio, directPersonGain]);
  useEffect(() => {
    if (remoteSoundboardAudio.current)
      void applyCallOutput(
        remoteSoundboardAudio.current,
        (outputVolume * soundboard.volume * directPersonGain) / 100,
        deafened || soundboard.muted,
        outputId,
      ).catch(() =>
        setErrorMessage("The selected audio output could not be opened."),
      );
  }, [
    remoteSoundboardAudio,
    directPersonGain,
    outputVolume,
    soundboard.volume,
    soundboard.muted,
    deafened,
    outputId,
  ]);
  useEffect(() => {
    if (remoteScreenAudio.current)
      void applyCallOutput(
        remoteScreenAudio.current,
        (outputVolume * streamVolume * directPersonGain) / 100,
        deafened ||
          !callViewOpen ||
          !remoteScreenSharing ||
          hiddenDirectTiles.includes("remote-screen") ||
          (focusedDirectVideo !== null && focusedDirectVideo !== "remote"),
        outputId,
      ).catch(() =>
        setErrorMessage("The selected audio output could not be opened."),
      );
  }, [
    remoteScreenAudio,
    directPersonGain,
    deafened,
    outputVolume,
    streamVolume,
    outputId,
    callViewOpen,
    remoteScreenSharing,
    hiddenDirectTiles,
    focusedDirectVideo,
  ]);

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
        if (!active) return;
        preloadServerPictures(data);
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
  const incomingServerInvitationCount = serverInvitations.rows.filter(
    (invite) => invite.incoming,
  ).length;
  const unreadMessageCount = Object.values(visibleDirectCounts).reduce(
    (total, count) => total + count,
    0,
  );
  const notificationCount = notificationsEnabled
    ? incomingFriendRequestCount +
      incomingServerInvitationCount +
      unreadMessageCount
    : 0;

  useEffect(() => {
    document.title =
      notificationsEnabled && unreadMessageCount
        ? `(${unreadMessageCount}) LC`
        : "LC";
    return () => {
      document.title = "LC";
    };
  }, [unreadMessageCount, notificationsEnabled]);

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
    const timeout = window.setTimeout(() => setIncomingCall(null), 20_000);
    return () => window.clearTimeout(timeout);
  }, [incomingCall]);

  useEffect(() => {
    if (!incomingCall || userStatus === "dnd" || !callsNotificationAllowed)
      return;
    prepareVoiceSounds();
    playVoiceSound("ring");
    const interval = window.setInterval(() => playVoiceSound("ring"), 1600);
    return () => {
      window.clearInterval(interval);
    };
  }, [incomingCall, userStatus, callsNotificationAllowed]);

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

  const directConversationVisible =
    friendsView &&
    (!callViewOpen ||
      conversationHasCall(
        activeVoiceChannelId,
        session?.user.id,
        selectedFriend?.id,
      ));
  const visibleDirectHistory = useRef<{
    accountId: string | undefined;
    userId: string;
    messages: ChatMessage[];
    nextCursor: MessageCursor | null;
  } | null>(null);
  useEffect(() => {
    if (
      visibleDirectHistory.current &&
      visibleDirectHistory.current.accountId !== session?.user.id
    ) {
      visibleDirectHistory.current = null;
      return;
    }
    visibleDirectHistory.current =
      directConversationVisible &&
      selectedFriend?.id &&
      directHistoryLoaded === selectedFriend.id
        ? {
            accountId: session?.user.id,
            userId: selectedFriend.id,
            messages: directMessages,
            nextCursor: directMessageCursor,
          }
        : null;
  }, [
    directConversationVisible,
    selectedFriend?.id,
    directHistoryLoaded,
    directMessages,
    directMessageCursor,
    session?.user.id,
  ]);
  useEffect(() => {
    const userId = selectedFriend?.id;
    const generation = ++directHistoryGeneration.current;
    const cached =
      userId && directConversationVisible
        ? conversationCache.current.get(session?.user.id, `direct:${userId}`)
        : undefined;
    directHistoryCacheable.current = cached ? userId! : "";
    const retained =
      directConversationVisible &&
      visibleDirectHistory.current?.accountId === session?.user.id &&
      visibleDirectHistory.current?.userId === userId
        ? visibleDirectHistory.current
        : null;
    void Promise.resolve().then(() => {
      if (generation !== directHistoryGeneration.current) return;
      setLoadingOlderDirect(false);
      if (retained && !cached) return;
      setDirectHistoryLoaded(cached ? userId! : "");
      setDirectMessages(cached?.messages ?? []);
      setDirectMessageCursor(cached?.nextCursor ?? null);
    });
    if (!userId || !directConversationVisible) return;
    if (cached)
      return () => {
        directHistoryGeneration.current = generation + 1;
      };
    const controller = new AbortController();
    void readHistoryWindow(
      async (cursor) => {
        const response = await fetch(
          `/api/direct-messages/${userId}${cursor ? `?${new URLSearchParams(cursor)}` : ""}`,
          { signal: controller.signal },
        );
        const page = await readJsonResponse<HistoryPage>(response);
        if (!response.ok) {
          if (
            [401, 403, 404].includes(response.status) &&
            generation === directHistoryGeneration.current
          ) {
            conversationCache.current.delete(
              session?.user.id,
              `direct:${userId}`,
            );
            setDirectMessages([]);
            setDirectMessageCursor(null);
          }
          throw new Error(apiErrorMessage(page));
        }
        if (!Array.isArray(page.messages))
          throw new Error("Messages could not be loaded.");
        return page;
      },
      retained ? retained.nextCursor : undefined,
    )
      .then((page) => {
        if (generation !== directHistoryGeneration.current) return;
        directHistoryCacheable.current = userId;
        conversationCache.current.set(session?.user.id, `direct:${userId}`, {
          messages: page.messages.map(toChatMessage),
          nextCursor: page.nextCursor,
        });
        setDirectMessages((current) =>
          retained
            ? reconcileRecoveredHistory(
                page.messages.map(toChatMessage),
                current,
                retained.messages,
              )
            : mergeChatMessages(page.messages.map(toChatMessage), current),
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
      controller.abort();
      directHistoryGeneration.current = generation + 1;
    };
  }, [
    selectedFriend?.id,
    directConversationVisible,
    session?.user.id,
    historyRefreshKey,
  ]);

  useEffect(() => {
    if (
      directConversationVisible &&
      selectedFriend?.id &&
      directHistoryLoaded === selectedFriend.id &&
      directHistoryCacheable.current === selectedFriend.id
    )
      conversationCache.current.set(
        session?.user.id,
        `direct:${selectedFriend.id}`,
        {
          messages: directMessages,
          nextCursor: directMessageCursor,
        },
      );
  }, [
    directMessages,
    directMessageCursor,
    directHistoryLoaded,
    directConversationVisible,
    selectedFriend?.id,
    session?.user.id,
  ]);

  async function loadOlderDirectMessages() {
    const userId = selectedFriend?.id;
    if (
      !userId ||
      !directConversationVisible ||
      !directMessageCursor ||
      loadingOlderDirect
    )
      return;
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
    if (query.trim().length < 3) {
      setFriendResults([]);
      return;
    }
    const response = await fetch(
      `/api/friends/search?q=${encodeURIComponent(query)}`,
    );
    if (response.ok) setFriendResults(await response.json());
  }

  async function friendAction(
    action: "request" | "accept" | "decline",
    friend: { id: string; handle?: string | null },
  ) {
    const response = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, userId: friend.id }),
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
    if (activeEdit) {
      await saveMessageEdit();
      return;
    }
    if (messageCooldown.blocked() || sendingMessageRef.current) return;
    const text = draft.trim();
    if (!selectedFriend || (!text && !files.length)) return;
    sendingMessageRef.current = true;
    setSendingMessage(true);
    try {
      const response = await sendMessageRequest(
        `/api/direct-messages/${selectedFriend.id}`,
        { text },
        files,
        setUploadProgress,
      );
      if (messageCooldown.handleResponse(response)) return;
      const message = await response.json();
      if (!response.ok)
        return setErrorMessage(message.error ?? "Message could not be sent.");
      conversationCache.current.delete(
        session?.user.id,
        `direct:${selectedFriend.id}`,
      );
      if (selectedFriendId.current === selectedFriend.id)
        setDirectMessages((current) =>
          mergeChatMessages(current, [toChatMessage(message)]),
        );
      clearSent();
      setHistoryContext((current) =>
        current?.key === composerKey ? null : current,
      );
      await loadFriends();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Message could not be sent.",
      );
    } finally {
      sendingMessageRef.current = false;
      setSendingMessage(false);
      setUploadProgress(null);
    }
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
      id: friendCallRoom(session!.user.id, friend.id),
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
    conversationCache.current.delete(session?.user.id, `direct:${partnerId}`);
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
    cancelFriendInvitation();
    send({ type: "hangup" });
    void recordCallOutcome("call-ended");
    returnToPreviousTextChannel();
  }

  function markUserUnavailable() {
    cancelFriendInvitation();
    void recordCallOutcome("user-unavailable");
    returnToPreviousTextChannel();
  }

  function cancelFriendInvitation() {
    const partnerId = friendCallPartnerId.current;
    if (partnerId && presenceSocket.current?.readyState === WebSocket.OPEN) {
      presenceSocket.current.send(
        JSON.stringify({ type: "call-cancel", targetUserId: partnerId }),
      );
    }
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
    const controller = new AbortController();
    void fetch(`/api/servers/${selectedServerId}/channels`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (active && (response.status === 401 || response.status === 403)) {
          serverViewCache.current.delete(session?.user.id, selectedServerId);
          setChannels([]);
          setMembers([]);
          setMessages([]);
          setSelectedChannelId("");
        }
        if (!response.ok) throw new Error("Channels could not be loaded.");
        return response.json();
      })
      .then((channelData: Channel[]) => {
        if (!active) return;
        const nextChannels = Array.isArray(channelData) ? channelData : [];
        serverViewCache.current.set(session?.user.id, selectedServerId, {
          ...serverViewCache.current.get(session?.user.id, selectedServerId),
          channels: nextChannels,
        });
        setChannels(nextChannels);
        setServerChannelsLoaded(selectedServerId);
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
        if (active && !kickedServers.current.has(selectedServerId)) {
          pendingLocation.current = null;
          setServerChannelsLoaded(selectedServerId);
          setNavigationReady(true);
          setErrorMessage("The server could not be loaded.");
        }
      });
    void fetch(`/api/servers/${selectedServerId}/members`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (active && (response.status === 401 || response.status === 403)) {
          serverViewCache.current.delete(session?.user.id, selectedServerId);
          setMembers([]);
        }
        if (!response.ok) throw new Error("Members could not be loaded.");
        return response.json();
      })
      .then((memberData: Member[]) => {
        if (active) {
          const nextMembers = Array.isArray(memberData) ? memberData : [];
          serverViewCache.current.set(session?.user.id, selectedServerId, {
            ...serverViewCache.current.get(session?.user.id, selectedServerId),
            members: nextMembers,
          });
          setMembers(nextMembers);
        }
      })
      .catch(() => {
        if (active && !kickedServers.current.has(selectedServerId))
          setErrorMessage("Members could not be loaded.");
      });
    return () => {
      active = false;
      controller.abort();
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
      throw new Error(result.error ?? "Could not leave the server.");
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
    const cached = serverViewCache.current.get(session?.user.id, serverId);
    const nextChannels = cached?.channels ?? [];
    const nextChannelId =
      restoredTextChannel(nextChannels) || nextChannels[0]?.id || "";
    const history =
      nextChannels.find((channel) => channel.id === nextChannelId)?.type ===
      "text"
        ? conversationCache.current.get(
            session?.user.id,
            `channel:${nextChannelId}`,
          )
        : undefined;
    channelHistoryGeneration.current += 1;
    setChannels(nextChannels);
    setMembers(cached?.members ?? []);
    setMessages(history?.messages ?? []);
    setSelectedChannelId(nextChannelId);
    setServerChannelsLoaded(cached?.channels ? serverId : "");
    setChannelHistoryLoaded(history ? nextChannelId : "");
    setReadableHistoryChannel(history ? nextChannelId : "");
    setNextMessageCursor(history?.nextCursor ?? null);
    setLoadingMoreMessages(false);
    setReplyingTo(null);
    setMessageMenu(null);
    lastTextChannelId.current = restoredTextChannel(nextChannels);
    setCallViewOpen(false);
    setSelectedServerId(serverId);
  }

  function selectTextChannel(channelId: string) {
    if (channelId !== selectedChannelId) {
      const cached = conversationCache.current.get(
        session?.user.id,
        `channel:${channelId}`,
      );
      channelHistoryGeneration.current += 1;
      setChannelHistoryLoaded(cached ? channelId : "");
      setReadableHistoryChannel(cached ? channelId : "");
      setMessages(cached?.messages ?? []);
      setNextMessageCursor(cached?.nextCursor ?? null);
      setLoadingMoreMessages(false);
    }
    lastTextChannelId.current = channelId;
    setCallViewOpen(false);
    setReplyingTo(null);
    setMessageMenu(null);
    setSelectedChannelId(channelId);
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
    if (!messageMenu) return;
    const closeMessageMenu = (event: PointerEvent) => {
      if (
        !messageContextMenu.current?.contains(event.target as Node) &&
        !(
          event.target instanceof Element &&
          event.target.closest(".emojiPopover")
        )
      ) {
        setMessageMenu(null);
      }
    };
    const closeMessageMenuOnScroll = (event: Event) => {
      if (!(
        event.target instanceof Element && event.target.closest(".emojiPopover")
      ))
        setMessageMenu(null);
    };
    document.addEventListener("pointerdown", closeMessageMenu);
    document.addEventListener("scroll", closeMessageMenuOnScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeMessageMenu);
      document.removeEventListener("scroll", closeMessageMenuOnScroll, true);
    };
  }, [messageMenu]);

  const historyChannelType = channels.find(
    (channel) => channel.id === selectedChannelId,
  )?.type;
  const visibleChannelHistory = useRef<{
    accountId: string | undefined;
    channelId: string;
    messages: ChatMessage[];
    nextCursor: MessageCursor | null;
  } | null>(null);
  useEffect(() => {
    if (
      visibleChannelHistory.current &&
      visibleChannelHistory.current.accountId !== session?.user.id
    ) {
      visibleChannelHistory.current = null;
      return;
    }
    visibleChannelHistory.current =
      historyChannelType === "text" &&
      channelHistoryLoaded === selectedChannelId
        ? {
            accountId: session?.user.id,
            channelId: selectedChannelId,
            messages,
            nextCursor: nextMessageCursor,
          }
        : null;
  }, [
    historyChannelType,
    channelHistoryLoaded,
    selectedChannelId,
    messages,
    nextMessageCursor,
    session?.user.id,
  ]);
  useEffect(() => {
    const generation = ++channelHistoryGeneration.current;
    const cached =
      historyChannelType === "text"
        ? conversationCache.current.get(
            session?.user.id,
            `channel:${selectedChannelId}`,
          )
        : undefined;
    channelHistoryCacheable.current = cached ? selectedChannelId : "";
    const retained =
      historyChannelType === "text" &&
      visibleChannelHistory.current?.accountId === session?.user.id &&
      visibleChannelHistory.current?.channelId === selectedChannelId
        ? visibleChannelHistory.current
        : null;
    void Promise.resolve().then(() => {
      if (generation !== channelHistoryGeneration.current) return;
      setLoadingMoreMessages(false);
      if (retained && !cached) return;
      setChannelHistoryLoaded(cached ? selectedChannelId : "");
      setReadableHistoryChannel(cached ? selectedChannelId : "");
      setMessages(cached?.messages ?? []);
      setNextMessageCursor(cached?.nextCursor ?? null);
    });
    if (!selectedChannelId || historyChannelType !== "text") return;
    if (cached)
      return () => {
        channelHistoryGeneration.current = generation + 1;
      };
    const controller = new AbortController();
    void readHistoryWindow(
      async (cursor) => {
        const response = await fetch(
          `/api/channels/${selectedChannelId}/messages${cursor ? `?${new URLSearchParams(cursor)}` : ""}`,
          { signal: controller.signal },
        );
        const page = await readJsonResponse<HistoryPage>(response);
        if (!response.ok) {
          if (
            [401, 403, 404].includes(response.status) &&
            generation === channelHistoryGeneration.current
          ) {
            conversationCache.current.delete(
              session?.user.id,
              `channel:${selectedChannelId}`,
            );
            setMessages([]);
            setNextMessageCursor(null);
          }
          throw new Error(apiErrorMessage(page));
        }
        if (!Array.isArray(page.messages))
          throw new Error("Messages could not be loaded.");
        return page;
      },
      retained ? retained.nextCursor : undefined,
    )
      .then((page) => {
        if (generation !== channelHistoryGeneration.current) return;
        channelHistoryCacheable.current = selectedChannelId;
        conversationCache.current.set(
          session?.user.id,
          `channel:${selectedChannelId}`,
          {
            messages: page.messages.map(toChatMessage),
            nextCursor: page.nextCursor,
          },
        );
        setMessages((current) =>
          retained
            ? reconcileRecoveredHistory(
                page.messages.map(toChatMessage),
                current,
                retained.messages,
              )
            : mergeChatMessages(page.messages.map(toChatMessage), current),
        );
        setNextMessageCursor(page.nextCursor);
        setChannelHistoryLoaded(selectedChannelId);
        setReadableHistoryChannel(selectedChannelId);
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
      controller.abort();
      channelHistoryGeneration.current = generation + 1;
    };
  }, [
    historyChannelType,
    selectedChannelId,
    session?.user.id,
    historyRefreshKey,
  ]);

  useEffect(() => {
    if (
      selectedChannelId &&
      channelHistoryLoaded === selectedChannelId &&
      channelHistoryCacheable.current === selectedChannelId
    )
      conversationCache.current.set(
        session?.user.id,
        `channel:${selectedChannelId}`,
        {
          messages,
          nextCursor: nextMessageCursor,
        },
      );
  }, [
    messages,
    nextMessageCursor,
    channelHistoryLoaded,
    selectedChannelId,
    session?.user.id,
  ]);

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

  const selectedChannelIsText = channels.some(
    (channel) => channel.id === selectedChannelId && channel.type === "text",
  );
  useEffect(() => {
    if (!selectedChannelId || !selectedChannelIsText) return;

    let hasOpened = false;
    const liveText = createReconnectingSignalingConnection({
      onSocket: (openedSocket) => {
        textSocket.current = openedSocket;
      },
      onOpen: (openedSocket) => {
        window.dispatchEvent(new CustomEvent("lc-message-reactions"));
        if (hasOpened) {
          conversationCache.current.delete(
            session?.user.id,
            `channel:${selectedChannelId}`,
          );
          setHistoryRefreshKey((current) => current + 1);
        }
        hasOpened = true;
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
          edit?: MessageEdit;
        };
        if (
          incoming.type === "message-edited" &&
          incoming.channelId === selectedChannelId &&
          incoming.edit
        ) {
          const edit = incoming.edit;
          setMessages((current) => applyMessageEdit(current, edit));
          setHistoryContext((current) =>
            current?.key === `${session?.user.id}:channel:${selectedChannelId}`
              ? {
                  ...current,
                  messages: applyMessageEdit(current.messages, edit),
                }
              : current,
          );
          return;
        }
        if (
          incoming.type === "message-deleted" &&
          incoming.channelId === selectedChannelId &&
          incoming.messageId
        ) {
          const removedId = incoming.messageId;
          setHistoryContext((current) =>
            current?.key === `${session?.user.id}:channel:${selectedChannelId}`
              ? {
                  ...current,
                  messages: applyMessageRemoval(
                    current.messages,
                    removedId,
                    !!incoming.permanent,
                  ),
                }
              : current,
          );
          setEditingMessage((current) =>
            current?.message.id === removedId ? null : current,
          );
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
      onError: () => undefined,
    });
    return () => {
      liveText.close();
      textSocket.current = null;
    };
  }, [selectedChannelIsText, selectedChannelId, session?.user.id]);

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
      stopScreenAudioSlot.current?.();
      soundPlayerRef.current?.stop();
      remoteAudio.current?.pause();
      if (remoteAudio.current) remoteAudio.current.srcObject = null;
      if (remoteScreenAudio.current) remoteScreenAudio.current.srcObject = null;
      if (remoteSoundboardAudio.current)
        remoteSoundboardAudio.current.srcObject = null;
      screenStream.current?.getTracks().forEach((track) => track.stop());
      stream.current?.getTracks().forEach((track) => track.stop());
      microphoneCapture.current?.stop();
    },
    [remoteAudio, remoteScreenAudio, remoteSoundboardAudio, soundPlayerRef],
  );

  useEffect(() => {
    const currentUserId = session?.user.id;
    if (authStatus !== "authenticated" || !currentUserId) return;
    const livePresence = createReconnectingSignalingConnection({
      onSocket: (openedSocket) => {
        presenceSocket.current = openedSocket;
      },
      onOpen: (openedSocket) => {
        if (presenceHasConnected.current) {
          // Another device may have accepted an invitation while this one was offline.
          void fetch("/api/servers")
            .then(async (response) => {
              if (!response.ok) return;
              const data = await response.json();
              if (
                presenceSocket.current === openedSocket &&
                Array.isArray(data)
              ) {
                invalidateSignalingToken();
                setServers(data);
              }
            })
            .catch(() => {});
          window.dispatchEvent(new CustomEvent("lc-message-reactions"));
          conversationCache.current.clear();
          serverViewCache.current.clear();
          setHistoryRefreshKey((current) => current + 1);
          const serverId = activeVoiceServerRef.current;
          if (serverId)
            void fetch(`/api/servers/${serverId}/voice-moderation`)
              .then(async (response) => {
                if (!response.ok) return;
                const policies = (await response.json()) as VoicePolicies;
                if (activeVoiceServerRef.current !== serverId) return;
                for (const [userId, policy] of Object.entries(policies))
                  applyVoiceModeration(serverId, userId, policy);
              })
              .catch(() => {});
        }
        presenceHasConnected.current = true;
        window.dispatchEvent(new CustomEvent("lc-server-invitations"));
        openedSocket.send(JSON.stringify({ type: "get-user-status" }));
        openedSocket.send(JSON.stringify({ type: "subscribe-workspace" }));
        if (pendingVoiceChannel.current)
          openedSocket.send(
            JSON.stringify({
              type: "set-voice-pending",
              roomId: pendingVoiceChannel.current,
              present: true,
            }),
          );
        void workspaceActivityRef.current.refresh();
        notificationInboxRef.current.refresh();
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
              reconnecting: true,
              sessionId: voiceSessionId.current,
              roomId: activeGroupChannelId.current,
              present: true,
              ...groupMediaRef.current,
              deafened: deafenedRef.current,
              muted: groupMediaRef.current.muted || deafenedRef.current,
            }),
          );
        }
      },
      onMessage: (event) => {
        const message = JSON.parse(event.data) as Signal;
        if (message.type === "server-order-updated") {
          void orderRefreshHandlers.current.servers().catch(() => undefined);
          return;
        }
        if (message.type === "channel-order-updated" && message.serverId) {
          void orderRefreshHandlers.current
            .channels(message.serverId)
            .catch(() => undefined);
          return;
        }
        const inbox = notificationInboxRef.current;
        const cue = notificationSoundGate.current.take(message, {
          userId: currentUserId,
          enabled: notificationPolicyRef.current.enabled,
          ready: inbox.ready,
          deafened: deafenedRef.current,
          channels: inbox.channels,
          allowed: inbox.allowed,
        });
        if (cue)
          playNotificationSound(
            cue,
            notificationPolicyRef.current.outputVolume,
          );
        if (message.type === "attachments-expired") {
          conversationCache.current.clear();
          setHistoryRefreshKey((current) => current + 1);
          return;
        }
        if (message.type === "attachment-storage-warning") {
          setNoticeMessage(
            "Attachment storage is over 80% full. Files older than 30 days may expire when space is needed.",
          );
          return;
        }
        if (message.type === "server-invitations-changed") {
          if (message.notice) setNoticeMessage(message.notice);
          window.dispatchEvent(
            new CustomEvent("lc-server-invitations", { detail: message }),
          );
          return;
        }
        if (
          message.type === "voice-moderation-changed" &&
          message.serverId &&
          message.userId &&
          typeof message.voiceMuted === "boolean" &&
          typeof message.voiceDeafened === "boolean"
        ) {
          applyVoiceModeration(message.serverId, message.userId, {
            voiceMuted: message.voiceMuted,
            voiceDeafened: message.voiceDeafened,
          });
          return;
        }
        if (message.type === "profile-updated" && message.userId) {
          if (message.image === null || typeof message.image === "string")
            applyProfilePicture(message.userId, message.image);
          if (typeof message.name === "string") {
            const { userId, name } = message;
            serverViewCache.current.clear();
            setMembers((rows) =>
              rows.map((person) =>
                person.id === userId ? { ...person, name } : person,
              ),
            );
            setFriends((rows) =>
              rows.map((person) =>
                person.id === userId ? { ...person, name } : person,
              ),
            );
            setSelectedFriend((person) =>
              person?.id === userId ? { ...person, name } : person,
            );
            setVoicePresence((rooms) =>
              Object.fromEntries(
                Object.entries(rooms).map(([id, people]) => [
                  id,
                  people.map((person) =>
                    person.userId === userId ? { ...person, name } : person,
                  ),
                ]),
              ),
            );
          }
          if (message.userId === currentUserId) void updateSessionRef.current();
          return;
        }
        if (message.type === "typing") {
          window.dispatchEvent(
            new CustomEvent("lc-typing", { detail: message }),
          );
          return;
        }
        if (message.type === "message-reactions-changed") {
          window.dispatchEvent(
            new CustomEvent("lc-message-reactions", {
              detail: { messageId: message.messageId },
            }),
          );
          return;
        }
        if (
          [
            "channel-activity",
            "channel-activity-changed",
            "channel-history-changed",
            "direct-message",
            "direct-message-edited",
            "direct-message-deleted",
            "notifications-changed",
            "server-mention",
            "access-changed",
            "server-updated",
            "friendship-changed",
          ].includes(message.type)
        )
          notificationInboxRef.current.refresh();
        if (message.type === "server-mention" && message.channelId) {
          const inbox = notificationInboxRef.current,
            serverId =
              message.serverId ??
              inbox.channels.find((channel) => channel.id === message.channelId)
                ?.serverId;
          if (
            inbox.ready &&
            serverId &&
            notificationPolicyRef.current.enabled &&
            inbox.allowed("server", serverId, "mentions") &&
            notificationPolicyRef.current.channelId !== message.channelId
          )
            setNoticeMessage(
              `${message.author ?? "Someone"} mentioned you in a server message.`,
            );
        }
        if (message.type === "voice-replaced") {
          handleVoiceReplacement(message.sessionId);
          return;
        }
        if (message.type === "voice-transfer-failed") {
          closeCallViewRef.current();
          setErrorMessage(
            "The voice service is unavailable. Your call could not reconnect. Please try again.",
          );
          return;
        }
        if (
          message.channelId &&
          [
            "channel-activity",
            "channel-activity-changed",
            "channel-history-changed",
            "channel-deleted",
          ].includes(message.type)
        ) {
          const key = `channel:${message.channelId}`;
          const cached = conversationCache.current.get(currentUserId, key);
          if (
            message.type !== "channel-activity" ||
            !cached?.messages.some((entry) => entry.id === message.messageId)
          )
            conversationCache.current.delete(currentUserId, key);
        }
        workspaceActivityRef.current.handle(message);
        if (message.type === "voice-move") {
          moveVoiceRef.current(message);
          return;
        }
        if (message.type === "user-status" && isUserStatus(message.status)) {
          localStorage.setItem(
            "lc.userStatus",
            message.automatic === true ? "online" : message.status,
          );
          setUserStatus(message.status);
          setAutomaticAway(message.automatic === true);
        }
        if (message.type === "access-changed") {
          serverOrderRequest.current++;
          channelOrderRequests.current.clear();
          if (
            message.reason === "server-kicked" ||
            message.reason === "server-deleted"
          ) {
            if (message.serverId) kickedServers.current.add(message.serverId);
            channelHistoryGeneration.current++;
            setNoticeMessage(
              message.reason === "server-deleted"
                ? "This server was deleted by an admin."
                : `You have been kicked from ${message.serverName ?? "the server"}.`,
            );
            setErrorMessage("");
            if (message.serverId === activeVoiceServerRef.current)
              closeCallViewRef.current();
            if (message.serverId === selectedServerIdRef.current) {
              setSelectedServerId("");
              setSelectedChannelId("");
              setChannels([]);
              setMembers([]);
              setMessages([]);
              setFriendsView(true);
              setSelectedFriend(null);
            }
          }
          setHistoryContext(null);
          setEditingMessage(null);
          conversationCache.current.clear();
          serverViewCache.current.clear();
          setHistoryRefreshKey((current) => current + 1);
          invalidateSignalingToken();
          refreshAccessRef.current();
          return;
        }
        if (message.type === "channel-deleted" && message.channelId) {
          if (activeVoiceChannelRef.current === message.channelId) {
            closeCallViewRef.current();
            if (message.reason === "admin")
              setNoticeMessage("This channel was deleted by an admin.");
          }
          setChannels((current) =>
            current.filter((channel) => channel.id !== message.channelId),
          );
          setSelectedChannelId((current) =>
            current === message.channelId ? "" : current,
          );
          invalidateSignalingToken();
          return;
        }
        if (message.type === "voice-sounds-changed" && message.serverId) {
          if (
            message.joinSoundId === null ||
            typeof message.joinSoundId === "string"
          )
            applyVoiceSoundSettings(message.serverId, message.joinSoundId);
          return;
        }
        if (message.type === "soundboard-updated" && message.serverId) {
          window.dispatchEvent(
            new CustomEvent("lc-soundboard-updated", {
              detail: { serverId: message.serverId },
            }),
          );
          return;
        }
        if (
          message.type === "server-picture-updated" &&
          message.serverId &&
          (message.image === null || typeof message.image === "string")
        ) {
          setServers((current) =>
            current.map((server) =>
              server.id === message.serverId
                ? { ...server, image: message.image as string | null }
                : server,
            ),
          );
          window.dispatchEvent(new CustomEvent("lc-server-invitations"));
          return;
        }
        if (message.type === "server-updated" && message.serverId) {
          window.dispatchEvent(
            new CustomEvent("lc-soundboard-updated", {
              detail: { serverId: message.serverId },
            }),
          );
          conversationCache.current.clear();
          serverViewCache.current.delete(currentUserId, message.serverId);
          invalidateSignalingToken();
          setSignalingRefreshKey((current) => current + 1);
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
            if (message.serverId !== selectedServerIdRef.current) return;
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
          if (
            pendingVoiceChannel.current === message.roomId &&
            !participants.some((person) => person.userId === currentUserId)
          )
            participants.push({
              userId: currentUserId,
              name: session?.user.name ?? "You",
              muted: true,
              camera: false,
              screen: false,
              speaking: false,
              connecting: true,
            });
          authoritativePresenceChannels.current.add(message.roomId);
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
          message.type === "direct-message-edited" &&
          message.fromUserId &&
          message.edit
        ) {
          const edit = message.edit,
            key = `direct:${message.fromUserId}`;
          void loadFriends();
          const cached = conversationCache.current.get(currentUserId, key);
          if (cached)
            conversationCache.current.set(currentUserId, key, {
              ...cached,
              messages: applyMessageEdit(cached.messages, edit),
            });
          if (selectedFriendId.current === message.fromUserId)
            setDirectMessages((current) => applyMessageEdit(current, edit));
          setHistoryContext((current) =>
            current?.key === `${currentUserId}:${key}`
              ? {
                  ...current,
                  messages: applyMessageEdit(current.messages, edit),
                }
              : current,
          );
        }
        if (
          message.type === "direct-message-deleted" &&
          message.fromUserId &&
          message.messageId
        ) {
          const removedId = message.messageId;
          setHistoryContext((current) =>
            current?.key === `${currentUserId}:direct:${message.fromUserId}`
              ? {
                  ...current,
                  messages: applyMessageRemoval(
                    current.messages,
                    removedId,
                    !!message.permanent,
                  ),
                }
              : current,
          );
          setEditingMessage((current) =>
            current?.message.id === removedId ? null : current,
          );
          conversationCache.current.delete(
            currentUserId,
            `direct:${message.fromUserId}`,
          );
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
          const key = `direct:${message.fromUserId}`;
          const cached = conversationCache.current.get(currentUserId, key);
          if (cached)
            conversationCache.current.set(currentUserId, key, {
              ...cached,
              messages: mergeChatMessages(cached.messages, [directMessage]),
            });
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
          !isFriendCall(directRoomId.current)
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
          isFriendCall(directRoomId.current) &&
          message.roomId === directRoomId.current
        ) {
          recordCallOutcomeRef.current("call-declined");
          closeCallViewRef.current();
        }
        if (message.type === "call-cancel")
          setIncomingCall((current) =>
            incomingCallMatches(current, message) ? null : current,
          );
      },
      // Presence reconnects automatically; a brief interruption does not need
      // a user-facing error because the participant list repairs itself.
      onError: () => undefined,
    });
    return () => {
      livePresence.close();
      presenceSocket.current = null;
    };
  }, [
    authStatus,
    session?.user.id,
    session?.user.name,
    signalingRefreshKey,
    applyVoiceModeration,
  ]);

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
              Object.entries(presence)
                .filter(
                  ([channelId]) =>
                    !authoritativePresenceChannels.current.has(channelId),
                )
                .map(([channelId, participants]) => [
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
      socket.current.send(
        JSON.stringify(
          signal.type === "media-state"
            ? {
                ...signal,
                speaking: signal.speaking || directSoundSpeaking.current,
                deafened: deafenedRef.current,
              }
            : signal,
        ),
      );
    }
  }

  function prepareRemoteAudio() {
    if (!remoteAudio.current) throw new Error("Call audio is not mounted");
    remoteAudio.current.setAttribute("playsinline", "");
    return remoteAudio.current;
  }

  async function playRemoteAudio() {
    const audio = prepareRemoteAudio();
    try {
      if (audio.srcObject) await audio.play();
      if (remoteScreenAudio.current?.srcObject)
        await remoteScreenAudio.current.play();
      if (remoteSoundboardAudio.current?.srcObject)
        await remoteSoundboardAudio.current.play();
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
      directMicSpeaking.current = speaking;
      updateDirectSpeaking();
    });
  }

  function updateDirectSpeaking() {
    const speaking = directMicSpeaking.current || directSoundSpeaking.current;
    setDirectLocalSpeaking(speaking);
    setDirectParticipantSpeaking(session?.user.id, speaking);
    send({
      type: "media-state",
      muted: effectiveMutedRef.current,
      camera: Boolean(stream.current?.getVideoTracks()[0]?.enabled),
      screen: screenSharing,
      speaking,
      soundboard: directSoundPlaying.current,
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
    stopScreenAudioSlot.current?.();
    const audioContext = prepareVoiceActivity()!;
    const silentMicrophone = !stream.current?.getAudioTracks().length
      ? reserveScreenAudio(peer, null, audioContext)
      : null;
    const screenTransceiver = reserveScreenAudio(
      peer,
      screenStream.current,
      audioContext,
    );
    soundPlayerRef.current?.stop();
    const soundTransceiver = reserveScreenAudio(peer, null, audioContext);
    soundboardSender.current = soundTransceiver.sender;
    stopScreenAudioSlot.current = () => {
      silentMicrophone?.stop();
      screenTransceiver.stop();
      soundTransceiver.stop();
    };
    screenAudioSender.current = screenTransceiver.sender;

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
        if (event.transceiver === soundTransceiver.transceiver) {
          const audio = remoteSoundboardAudio.current;
          if (audio) {
            audio.srcObject = new MediaStream([event.track]);
            void audio.play().catch(() => setAudioPlaybackBlocked(true));
          }
          return;
        }
        if (event.transceiver === screenTransceiver.transceiver) {
          const audio = remoteScreenAudio.current;
          if (audio) {
            audio.srcObject = new MediaStream([event.track]);
            void audio.play().catch(() => setAudioPlaybackBlocked(true));
          }
          return;
        }
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
      if (peer.connectionState === "connected") {
        void nativeAudioGate.current?.update(directTransmitBlockedRef.current);
        setStatus("Media connected");
        if (pendingJoinAnnouncement.current) {
          pendingJoinAnnouncement.current = false;
          soundboard.playJoinSound(session?.user.id, publishDirectSound);
        }
      }
      if (["disconnected", "failed"].includes(peer.connectionState)) {
        setStatus("Guest disconnected");
      }
    };
    connection.current = peer;
    nativeAudioGate.current = createAudioTransmissionGate(peer, () => {
      if (connection.current === peer)
        setErrorMessage(
          "Could not update outgoing audio. Try reconnecting the call.",
        );
    });
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
    await nativeAudioGate.current?.update(directTransmitBlockedRef.current);
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
    if (message.type === "voice-replaced" && "sessionId" in message) {
      handleVoiceReplacement(message.sessionId);
      return;
    }
    if (message.type === "voice-transfer-failed") {
      returnToPreviousTextChannel();
      setErrorMessage(
        "Could not transfer your call. The group voice service (LiveKit) may be unavailable. Please try again.",
      );
      return;
    }
    if (message.type === "voice-kicked") {
      setNoticeMessage(
        "You were disconnected from the voice channel by its owner.",
      );
      returnToPreviousTextChannel();
      return;
    }
    if (message.type === "joined") {
      updatePendingVoice(directRoomId.current, false);
      setJoining(false);
      setJoined(true);
      setStatus("Waiting for another person...");
      if (!directReconnectInProgress.current) {
        pendingJoinAnnouncement.current = message.initiator === false;
        if (!pendingJoinAnnouncement.current)
          soundboard.playJoinSound(session?.user.id);
      }
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
      updatePendingVoice(directRoomId.current, false);
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
      soundboard.playJoinSound(message.userId);
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
      await nativeAudioGate.current?.update(directTransmitBlockedRef.current);
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
        soundPlayerRef.current?.stop();
        soundboardSender.current = null;
        if (remoteSoundboardAudio.current)
          remoteSoundboardAudio.current.srcObject = null;
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
        if (remoteScreenAudio.current)
          remoteScreenAudio.current.srcObject = null;
        remoteSharing.current = false;
        stopScreenAudioSlot.current?.();
        stopScreenAudioSlot.current = null;
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
      if (!message.enabled && remoteSharing.current && !deafened)
        playVoiceSound("share-stop");
      if (message.enabled && !remoteSharing.current && !deafened)
        playVoiceSound("share");
      remoteSharing.current = Boolean(message.enabled);
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
    setMediaPermissionsGranted(
      devices.some(
        (device) => device.kind === "audioinput" && !!device.label,
      ) &&
        devices.some(
          (device) => device.kind === "videoinput" && !!device.label,
        ),
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
      setMediaPermissionsGranted(true);
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
        .find(
          (candidate) =>
            candidate !== screenAudioSender.current &&
            candidate !== soundboardSender.current &&
            candidate.track?.kind === "audio",
        );
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
    const originalStream = stream.current;
    try {
      const replacement = await captureCamera(cameraConstraints(deviceId));
      if (
        stream.current !== originalStream ||
        oldTrack.readyState === "ended"
      ) {
        replacement.getTracks().forEach((track) => track.stop());
        return;
      }
      const nextTrack = replacement.getVideoTracks()[0];
      nextTrack.enabled = oldTrack.enabled;
      cameraSource(nextTrack).enabled = oldTrack.enabled;
      nextTrack.contentHint = "detail";
      const sender = connection.current
        ?.getSenders()
        .find((candidate) => candidate.track?.kind === "video");
      if (sender && !screenStream.current) {
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
    media = groupMediaRef.current,
    sessionId = voiceSessionId.current,
    reconnecting = false,
  ) {
    if (present) groupMediaRef.current = media;
    if (target?.readyState !== WebSocket.OPEN) return;
    target.send(
      JSON.stringify({
        type: "set-group-presence",
        sessionId,
        reconnecting,
        roomId: channelId,
        participantName: session?.user.name ?? "Guest",
        present,
        ...media,
        deafened: deafenedRef.current,
        muted: media.muted || deafenedRef.current,
      }),
    );
  }

  function handleGroupConnection(
    channelId: string,
    present: boolean,
    sessionId = voiceSessionId.current,
  ) {
    if (sessionId !== voiceSessionId.current) return;
    if (present && pendingVoiceChannel.current === channelId)
      updatePendingVoice(channelId, false);
    if (present || activeGroupChannelId.current === channelId)
      activeGroupChannelId.current = present ? channelId : "";
    setConnectedGroupChannelId((current) =>
      present ? channelId : current === channelId ? "" : current,
    );
    sendGroupPresence(
      channelId,
      present,
      presenceSocket.current,
      groupMediaRef.current,
      sessionId,
    );
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
    const joiningSessionId = voiceSessionId.current;
    const captureGeneration = peerGeneration.current;
    directRoomId.current = channelId;
    directReconnectInProgress.current = reconnecting;
    setJoining(true);
    setStatus(
      reconnecting ? "Reconnecting signaling..." : "Requesting microphone...",
    );
    setMediaNotice("");

    if (!channelId.startsWith("friend:")) {
      const serverId =
        channels.find((channel) => channel.id === channelId)?.serverId ??
        activeVoiceChannelSnapshot?.serverId ??
        selectedServerId;
      try {
        const response = await fetch(
          `/api/servers/${serverId}/voice-moderation`,
        );
        if (!response.ok)
          throw new Error("Voice permissions could not be checked.");
        const policies = (await response.json()) as VoicePolicies;
        if (
          captureGeneration !== peerGeneration.current ||
          directRoomId.current !== channelId
        )
          return;
        setVoicePolicies((current) => ({
          ...current,
          [`${session?.user.id}:${serverId}`]: policies,
        }));
        directTransmitBlockedRef.current =
          voiceBlocked(policies[session?.user.id ?? ""]) ||
          Boolean(policies[directPeerUserId ?? ""]?.voiceDeafened) ||
          Boolean(participantAudio.values[directPeerUserId ?? ""]?.deafened);
      } catch {
        setJoining(false);
        setErrorMessage(
          "Voice permissions could not be checked. Please try joining again.",
        );
        return;
      }
    }
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
    if (
      captureGeneration !== peerGeneration.current ||
      voiceSessionId.current !== joiningSessionId
    ) {
      ws.close();
      return;
    }
    socket.current = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "join",
          sessionId: joiningSessionId,
          reconnecting,
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
    disconnectedVoiceSessionId.current = "";
    if (pendingVoiceChannel.current)
      updatePendingVoice(pendingVoiceChannel.current, false);
    directMicSpeaking.current = false;
    soundPlayerRef.current?.stop();
    soundboard.preview.current?.stop();
    soundboard.stopJoinSound();
    pendingJoinAnnouncement.current = false;
    soundboard.setOpen(false);
    soundboardSender.current = null;
    if (remoteSoundboardAudio.current)
      remoteSoundboardAudio.current.srcObject = null;
    stopScreenAudioSlot.current?.();
    stopScreenAudioSlot.current = null;
    screenAudioSender.current = null;
    remoteSharing.current = false;
    if (remoteScreenAudio.current) remoteScreenAudio.current.srcObject = null;
    setScreenShareOptionsOpen(false);
    const groupChannelId = activeGroupChannelId.current;
    if (groupChannelId) handleGroupConnection(groupChannelId, false);
    voiceSessionId.current = "";
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

  function handleGroupLeave(sessionId: string) {
    if (!sessionId || sessionId !== voiceSessionId.current) return;
    closeCallViewRef.current();
    // Media removal can arrive before signaling explains the handoff.
    disconnectedVoiceSessionId.current = sessionId;
  }

  function handleVoiceReplacement(sessionId?: string) {
    if (!sessionId) return;
    if (sessionId === voiceSessionId.current) {
      closeCallViewRef.current();
    } else if (
      voiceSessionId.current ||
      sessionId !== disconnectedVoiceSessionId.current
    ) {
      return;
    }
    disconnectedVoiceSessionId.current = "";
    setVoiceTransferOpen(true);
  }

  function toggleAudio() {
    if (deafened || voiceBlocked(ownVoicePolicy)) return;
    if (!takeVoiceToggle()) return;
    const track = stream.current?.getAudioTracks()[0];
    if (!track) {
      const nextMuted = !microphoneMuted;
      setMuted(nextMuted);
      playVoiceSound(nextMuted ? "mute" : "unmute");
      return;
    }
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
      playVoiceSound(track.enabled ? "unmute" : "mute");
      send({
        type: "media-state",
        muted: !track.enabled,
        camera: !cameraOff,
        screen: screenSharing,
        speaking: false,
      });
    }
  }

  async function changeServerVoicePolicy(userId: string, patch: VoicePolicy) {
    const response = await fetch(
      `/api/servers/${selectedServerId}/voice-moderation`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      },
    );
    const policy = await response.json();
    if (!response.ok)
      throw new Error(
        policy.error ?? "Could not change server voice controls.",
      );
    applyVoiceModeration(selectedServerId, userId, policy);
    if (!policy.mediaSynced)
      setErrorMessage(
        "Voice policy saved, but the media server could not be updated. The user must reconnect for server enforcement.",
      );
  }

  function toggleDeafen() {
    if (ownVoicePolicy?.voiceDeafened) return;
    if (!takeVoiceToggle()) return;
    const next = !deafened;
    deafenedRef.current = next;
    setMicrophoneDeafened(next);
    setDeafened(next);
    const nextMuted =
      microphoneMuted || next || Boolean(ownVoicePolicy?.voiceMuted);
    effectiveMutedRef.current = nextMuted;
    stream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    if (remoteAudio.current) remoteAudio.current.muted = next;
    if (activeGroupChannelId.current)
      sendGroupPresence(
        activeGroupChannelId.current,
        true,
        presenceSocket.current,
        { ...groupMediaRef.current, muted: nextMuted, speaking: false },
      );
    send({
      type: "media-state",
      muted: nextMuted,
      camera: !cameraOff,
      screen: screenSharing,
      speaking: false,
    });
    playVoiceSound(next ? "deafen" : "undeafen");
  }

  async function toggleVideo() {
    const track = stream.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      cameraSource(track).enabled = track.enabled;
      setCameraOff(!track.enabled);
      playVoiceSound(track.enabled ? "camera-on" : "camera-off");
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

    const generation = peerGeneration.current;
    try {
      const cameraStream = await captureCamera(cameraConstraints(cameraId));
      if (generation !== peerGeneration.current) {
        cameraStream.getTracks().forEach((track) => track.stop());
        return;
      }
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
      playVoiceSound("camera-on");
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
    if (!deafened) playVoiceSound("share-stop");
    await screenAudioSender.current?.replaceTrack(null).catch(() => {});
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

  async function toggleScreenShare(
    resolution?: ScreenShareResolution,
    frameRate: VideoFrameRate = 30,
  ) {
    if (screenStream.current) {
      await stopScreenShare();
      return;
    }
    if (!resolution) {
      setScreenShareOptionsOpen(true);
      return;
    }
    setScreenShareOptionsOpen(false);
    const generation = peerGeneration.current;
    try {
      const quality = screenShareResolutions[resolution];
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: quality.width, max: quality.width },
          height: { ideal: quality.height, max: quality.height },
          frameRate: { ideal: frameRate, max: frameRate },
        },
        audio: sharedAudioCapture,
      });
      if (generation !== peerGeneration.current) {
        display.getTracks().forEach((track) => track.stop());
        return;
      }
      const screenTrack = display.getVideoTracks()[0];
      if (!screenTrack) throw new Error("No screen track");
      screenTrack.contentHint = frameRate === 60 ? "motion" : "detail";
      screenStream.current = display;
      if (screenAudioSender.current)
        await screenAudioSender.current.replaceTrack(
          display.getAudioTracks()[0] ?? null,
        );
      if (display.getAudioTracks()[0])
        display.getAudioTracks()[0].contentHint = "music";
      if (screenAudioSender.current)
        await preferSharedAudio(screenAudioSender.current);
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
          await preferVideoDetail(sender, frameRate);
        } else {
          const nextSender = peer.addTrack(screenTrack, display);
          await preferVideoDetail(nextSender, frameRate);
          await createOffer();
        }
      }
      if (generation !== peerGeneration.current) {
        display.getTracks().forEach((track) => track.stop());
        return;
      }
      if (localVideo.current) localVideo.current.srcObject = display;
      setScreenSharing(true);
      if (!deafened) playVoiceSound("share");
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
    if (activeEdit) {
      await saveMessageEdit();
      return;
    }
    if (messageCooldown.blocked() || sendingMessageRef.current) return;
    const text = draft.trim();
    if ((!text && !files.length) || !selectedChannelId) return;
    const generation = channelHistoryGeneration.current;
    sendingMessageRef.current = true;
    setSendingMessage(true);
    try {
      const response = await sendMessageRequest(
        `/api/channels/${selectedChannelId}/messages`,
        { text, replyToId: replyingTo?.id },
        files,
        setUploadProgress,
      );
      if (messageCooldown.handleResponse(response)) return;
      const message =
        await readJsonResponse<Parameters<typeof toChatMessage>[0]>(response);
      if (!response.ok) throw new Error(apiErrorMessage(message));
      conversationCache.current.delete(
        session?.user.id,
        `channel:${selectedChannelId}`,
      );
      clearSent();
      if (generation !== channelHistoryGeneration.current) return;
      setHistoryContext((current) =>
        current?.key === composerKey ? null : current,
      );
      setReplyingTo(null);
      const chatMessage = toChatMessage(message);
      setMessages((current) =>
        current.some((candidate) => candidate.id === chatMessage.id)
          ? current
          : [...current, chatMessage],
      );
    } catch (error) {
      if (generation !== channelHistoryGeneration.current) return;
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The message could not be sent.",
      );
    } finally {
      sendingMessageRef.current = false;
      setSendingMessage(false);
      setUploadProgress(null);
    }
  }

  async function saveMessageEdit() {
    const editing = activeEdit;
    if (!editing || sendingMessageRef.current || messageCooldown.blocked())
      return;
    sendingMessageRef.current = true;
    setSendingMessage(true);
    try {
      const response = await fetch(
        editing.userId
          ? `/api/direct-messages/${editing.userId}/${editing.message.id}`
          : `/api/messages/${editing.message.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: editDraft }),
        },
      );
      if (messageCooldown.handleResponse(response)) return;
      const edit = await readJsonResponse<MessageEdit>(response);
      if (!response.ok) throw new Error(apiErrorMessage(edit));
      const cacheKey = editing.userId
        ? `direct:${editing.userId}`
        : `channel:${editing.channelId}`;
      const cached = conversationCache.current.get(session?.user.id, cacheKey);
      if (cached)
        conversationCache.current.set(session?.user.id, cacheKey, {
          ...cached,
          messages: applyMessageEdit(cached.messages, edit),
        });
      if (editing.userId) {
        if (selectedFriendId.current === editing.userId)
          setDirectMessages((current) => applyMessageEdit(current, edit));
      } else if (lastTextChannelId.current === editing.channelId)
        setMessages((current) => applyMessageEdit(current, edit));
      updateContext(edit, editing.key);
      if (editing.userId) await loadFriends();
      setEditingMessage((current) => (current === editing ? null : current));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Message could not be edited.",
      );
    } finally {
      sendingMessageRef.current = false;
      setSendingMessage(false);
    }
  }

  async function createServer(event: FormEvent) {
    event.preventDefault();
    const name = formName.trim();
    if (!name) return;
    const response = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, createAfk }),
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

  async function moveVoiceParticipant(
    userId: string,
    channelId: string,
    destinationId: string,
  ) {
    try {
      const response = await fetch(
        `/api/servers/${selectedServerId}/voice-move`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, channelId, destinationId }),
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not move this person.");
      setNoticeMessage("Voice move sent.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Could not move this person.",
      );
    }
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
    conversationCache.current.clear();
    const removedKey = `${session?.user.id}:${candidate.conversationUserId ? `direct:${candidate.conversationUserId}` : `channel:${selectedChannelId}`}`;
    setHistoryContext((current) =>
      current?.key === removedKey
        ? {
            ...current,
            messages: applyMessageRemoval(
              current.messages,
              candidate.id,
              permanentMessageDeletion,
            ),
          }
        : current,
    );
    setEditingMessage((current) =>
      current?.message.id === candidate.id ? null : current,
    );
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
    setMessageMenu(null);
    setDeleteMessageCandidate(null);
    setPermanentMessageDeletion(false);
  }

  function closeForm() {
    setForm(null);
    setFormName("");
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
        : target.kind === "server"
          ? "/api/servers"
          : `/api/servers/${selectedServerId}/channels`;
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        ...(target.kind === "server"
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
    if (target.kind === "server") {
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

  function updatePendingVoice(channelId: string, present: boolean) {
    if (!channelId || channelId.startsWith("friend:")) return;
    if (!present && pendingVoiceChannel.current !== channelId) return;
    pendingVoiceChannel.current = present ? channelId : "";
    if (presenceSocket.current?.readyState === WebSocket.OPEN)
      presenceSocket.current.send(
        JSON.stringify({
          type: "set-voice-pending",
          roomId: channelId,
          present,
        }),
      );
    setVoicePresence((current) => {
      const people = (current[channelId] ?? []).filter(
        (person) => !(person.userId === session?.user.id && person.connecting),
      );
      if (
        present &&
        !people.some((person) => person.userId === session?.user.id)
      )
        people.push({
          userId: session?.user.id,
          name: session?.user.name ?? "You",
          muted: true,
          camera: false,
          screen: false,
          speaking: false,
          connecting: true,
        });
      return { ...current, [channelId]: people };
    });
  }

  function selectVoiceChannel(channel: Channel) {
    setMediaFocusTarget(null);
    if (activeVoiceChannelId === channel.id) {
      setCallViewOpen(true);
      return;
    }
    prepareVoiceActivity();
    prepareRemoteAudio();
    prepareVoiceSounds();
    leaveRoom();
    voiceSessionId.current = crypto.randomUUID();
    updatePendingVoice(channel.id, true);
    setActiveVoiceChannelId(channel.id);
    setActiveVoiceChannelSnapshot({
      ...channel,
      serverId: channel.id.startsWith("friend:")
        ? undefined
        : (channel.serverId ?? selectedServerId),
      serverName: channel.id.startsWith("friend:")
        ? undefined
        : servers.find(
            (server) => server.id === (channel.serverId ?? selectedServerId),
          )?.name,
    });
    setCallViewOpen(false);
    setVoiceJoinTarget(channel.id);
    setVoiceJoinKey((current) => current + 1);
    setCallPeerPresent(false);
    if (channel.type === "voice_direct") {
      if (channel.id.startsWith("friend:"))
        friendCallStartedAt.current = Date.now();
      const joiningSession = voiceSessionId.current;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (voiceSessionId.current === joiningSession)
            void joinRoom(channel.id);
        });
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
  const conversationCallActive = conversationHasCall(
    activeVoiceChannel?.id,
    session?.user.id,
    selectedFriend?.id,
  );
  const showFriendsCallMedia = conversationCallActive || callViewOpen;
  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId,
  );
  const displayedChannel =
    callViewOpen && activeVoiceChannel ? activeVoiceChannel : selectedChannel;
  const isSelectedServerOwner = members.some(
    (member) => member.id === session?.user.id && member.role === "owner",
  );
  const serverDrag = useDragReorder({
    items: servers,
    scope: `servers:${session?.user.id}:${friendsView}`,
    enabled: !!session,
    onReorder: moveServer,
  });
  const channelDrag = useDragReorder({
    items: channels.map((channel) => ({
      ...channel,
      group: channel.type === "text" ? "text" : "voice",
    })),
    scope: `channels:${session?.user.id}:${selectedServerId}:${friendsView}`,
    enabled: isSelectedServerOwner,
    onReorder: async (id, targetId, placement) => {
      const channel = channels.find((row) => row.id === id);
      if (channel) await moveChannel(channel, targetId, placement);
    },
  });
  const isSelectedServerModerator = members.some(
    (member) => member.id === session?.user.id && member.role === "mod",
  );
  const directRemoteName =
    voicePresence[activeVoiceChannelId]?.find(
      (participant) => participant.userId !== session?.user.id,
    )?.name ??
    (activeVoiceChannelId.startsWith("friend:")
      ? activeVoiceChannel?.name
      : "Guest");
  const localDirectTileId = screenSharing ? "local-screen" : "local";
  function openParticipantMedia(
    channel: Channel,
    participant: VoiceParticipant,
    kind: "camera" | "screen",
  ) {
    if (activeVoiceChannelId !== channel.id) selectVoiceChannel(channel);
    setCallViewOpen(true);
    if (channel.type === "voice_group" && participant.userId) {
      setMediaFocusTarget({
        userId: participant.userId,
        kind,
        requestId: Date.now(),
      });
    } else {
      const local = participant.userId === session?.user.id;
      setHiddenDirectTiles((current) =>
        current.filter((id) =>
          local ? !id.startsWith("local") : !id.startsWith("remote"),
        ),
      );
      setFocusedDirectVideo(local ? "local" : "remote");
    }
  }
  const remoteDirectTileId = remoteScreenSharing ? "remote-screen" : "remote";
  const directLocalLabel = `${session?.user.name ?? "You"}${screenSharing ? " — screen" : ""}`;
  const directRemoteLabel = `${directRemoteName}${remoteScreenSharing ? " — screen" : ""}`;
  const hideDirectTile = (id: string) => {
    setHiddenDirectTiles((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setFocusedDirectVideo(null);
  };
  const directHiddenMenu = !focusedDirectVideo && (
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
  const directSelfViewButton = !focusedDirectVideo && (
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
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 150)),
    });
  };

  const incomingCallOverlay = (
    <IncomingCallNotice
      call={incomingCall}
      status={callsNotificationAllowed ? userStatus : "dnd"}
      conversationUserId={
        friendsView && (!callViewOpen || conversationCallActive)
          ? selectedFriend?.id
          : undefined
      }
      onAnswer={answerIncomingCall}
      onDecline={declineIncomingCall}
    />
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
  const renderAudioDeviceOptions = (
    mode: "input" | "output" | "both",
    controls: "all" | "devices" | "levels" = "all",
  ) => (
    <AudioDeviceOptions
      controls={controls}
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
  async function changeCameraResolution(resolution: CameraResolution) {
    localStorage.setItem("lc.cameraResolution", resolution);
    setCameraResolution(resolution);
    const track = stream.current?.getVideoTracks()[0];
    if (track) {
      try {
        await cameraSource(track).applyConstraints(
          cameraCaptureConstraints(cameraId, resolution),
        );
        if (!screenStream.current) {
          const sender = connection.current
            ?.getSenders()
            .find((item) => item.track?.kind === "video");
          if (sender) await preferVideoDetail(sender, cameraFrameRate);
        }
      } catch {
        setErrorMessage("The selected camera resolution could not be applied.");
      }
    }
  }
  async function changeCameraFrameRate(frameRate: VideoFrameRate) {
    localStorage.setItem("lc.cameraFrameRate", String(frameRate));
    setCameraFrameRate(frameRate);
    const track = stream.current?.getVideoTracks()[0];
    try {
      await (track ? cameraSource(track) : undefined)?.applyConstraints(
        cameraCaptureConstraints(cameraId, cameraResolution, frameRate),
      );
      if (!screenStream.current) {
        const sender = connection.current
          ?.getSenders()
          .find((item) => item.track?.kind === "video");
        if (sender) await preferVideoDetail(sender, frameRate);
      }
    } catch {
      setErrorMessage("The selected camera frame rate could not be applied.");
    }
  }
  const cameraResolutionOptions = (
    <>
      <CameraResolutionSelection
        resolution={cameraResolution}
        frameRate={cameraFrameRate}
        onFrameRateChange={(value) => void changeCameraFrameRate(value)}
        onChange={(value) => void changeCameraResolution(value)}
      />
      <CameraMirrorControl />
    </>
  );
  const audioDeviceOptions = renderAudioDeviceOptions("input");
  const profilePanel = session && (
    <footer className="profileBar">
      <div
        className={`accountMenu profileMenu ${accountMenuOpen ? "open" : ""}`}
      >
        <UserStatusMenu
          image={session.user.image}
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
          onChange={(next) => changePresenceStatus(next)}
        />
        {!activeVoiceChannel && (
          <div className="controls profileMicrophone">
            <DeviceMenu
              kind="microphone"
              actionUnavailable={deafened || voiceBlocked(ownVoicePolicy)}
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
            actionUnavailable={Boolean(ownVoicePolicy?.voiceDeafened)}
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
              if (isFriendCall(activeVoiceChannel.id)) endFriendCall();
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
    <WorkspaceLinks
      onLegal={setLegalDocument}
      onHelp={() => setHelpRequest((value) => value + 1)}
    />
  );
  const compactLegalLinks = (
    <div className="compactWorkspaceLinks">{legalLinks}</div>
  );
  const legalTitle =
    legalDocument === "impressum"
      ? "Impressum"
      : legalDocument === "licenses"
        ? "Third-party licenses"
        : "Privacy notice";
  const legalOverlay = legalDocument && (
    <div
      className="modalBackdrop legalModalBackdrop"
      onMouseDown={() => setLegalDocument(null)}
    >
      <section
        className="legalModal"
        role="dialog"
        aria-modal="true"
        aria-label={legalTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>{legalTitle}</strong>
          <button
            type="button"
            aria-label="Close legal document"
            onClick={() => setLegalDocument(null)}
          >
            ×
          </button>
        </header>
        <LegalFrame
          title={legalTitle}
          document={legalDocument}
          onClose={() => setLegalDocument(null)}
        />
      </section>
    </div>
  );

  const notificationMuteMenu = notificationTarget && (
    <NotificationMuteMenu
      key={`${notificationTarget.scope}:${notificationTarget.id}`}
      target={notificationTarget}
      preferences={notificationInbox.preferences}
      onSave={notificationInbox.save}
      onClose={closeNotificationMute}
    >
      {notificationTarget.scope === "direct" && (
        <ParticipantAudioControls
          value={participantAudio.values[notificationTarget.id]}
          onChange={(patch) =>
            participantAudio.change(notificationTarget.id, patch)
          }
        />
      )}
    </NotificationMuteMenu>
  );
  async function refreshServerOrder() {
    const account = session?.user.id,
      request = ++serverOrderRequest.current;
    const response = await fetch("/api/servers", { cache: "no-store" });
    if (!response.ok) throw new Error("Server order could not be refreshed.");
    const rows = await response.json();
    if (
      account === invitationAccount.current &&
      request === serverOrderRequest.current &&
      Array.isArray(rows)
    )
      setServers(rows);
  }
  async function refreshChannelOrder(serverId: string) {
    const account = session?.user.id,
      request = (channelOrderRequests.current.get(serverId) ?? 0) + 1;
    channelOrderRequests.current.set(serverId, request);
    const response = await fetch(`/api/servers/${serverId}/channels`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Channel order could not be refreshed.");
    const rows = await response.json();
    if (
      account !== invitationAccount.current ||
      request !== channelOrderRequests.current.get(serverId) ||
      !Array.isArray(rows)
    )
      return;
    const cached = serverViewCache.current.get(account, serverId);
    if (cached)
      serverViewCache.current.set(account, serverId, {
        ...cached,
        channels: rows,
      });
    if (serverId === selectedServerIdRef.current) setChannels(rows);
  }
  async function moveServer(
    serverId: string,
    targetId: string,
    placement: DropPlacement,
  ) {
    const response = await fetch("/api/servers/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, targetId, placement }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error ??
          "Server could not be moved. Please try again.",
      );
    await refreshServerOrder();
  }
  async function moveChannel(
    channel: Channel,
    targetId: string,
    placement: DropPlacement,
  ) {
    const serverId = channel.serverId ?? selectedServerId;
    const response = await fetch(`/api/servers/${serverId}/channels/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelId: channel.id, targetId, placement }),
    });
    if (!response.ok)
      throw new Error(
        (await response.json().catch(() => null))?.error ??
          "Channel could not be moved. Please try again.",
      );
    await refreshChannelOrder(serverId);
  }
  const serverContextMenu = serverContext && (
    <div
      className="messageContextMenu"
      role="menu"
      ref={serverContextRef}
      style={{ left: serverContext.x, top: serverContext.y }}
    >
      <button
        type="button"
        role="menuitem"
        onClick={(event) => {
          openNotificationMute(
            {
              clientX: serverContext.x,
              clientY: serverContext.y,
              preventDefault: () => event.preventDefault(),
            },
            "server",
            serverContext.server,
          );
          setServerContext(null);
        }}
      >
        Mute notifications…
      </button>
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
          } else setLeaveServerTarget(target);
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
      {!mediaPermissionsGranted && (
        <>
          <p>
            Grant access once so LC can show device names and use your saved
            choices when you join.
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
        </>
      )}
      <MediaTests
        microphoneId={microphoneId}
        cameraId={cameraId}
        cameraResolution={cameraResolution}
        cameraFrameRate={cameraFrameRate}
        outputVolume={outputVolume}
        outputId={outputId}
        deafened={deafened}
        audioDevices={
          <>
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
            {renderAudioDeviceOptions("both", "devices")}
          </>
        }
        audioLevels={renderAudioDeviceOptions("both", "levels")}
        cameraDevices={
          <>
            <DeviceSelection
              label="Camera"
              devices={cameras}
              selectedId={cameraId}
              onSelect={selectCamera}
            />
            <small>
              Camera access is requested here for setup, but your camera remains
              off when joining a channel.
            </small>
            {cameraResolutionOptions}
          </>
        }
      />
    </div>
  );

  const profileOverlay = profileUser && session && (
    <UserProfile
      key={profileUser.id}
      user={{
        ...friends.find((friend) => friend.id === profileUser.id),
        ...profileUser,
        image: userImage(profileUser.id, profileUser.image),
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
      onEditProfile={
        profileUser.id === session.user.id
          ? () => {
              setProfileUser(null);
              setServerSettingsOpen(false);
              setUserSettingsSection("account");
              setAccountMenuOpen(true);
            }
          : undefined
      }
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
  function applyVoiceSoundSettings(
    serverId: string,
    joinSoundId: string | null,
  ) {
    setServers((current) =>
      current.map((server) =>
        server.id === serverId ? { ...server, joinSoundId } : server,
      ),
    );
  }
  const serverSoundSettings = (
    <SoundManager
      key={selectedServerId}
      serverId={selectedServerId}
      joinSoundOnly={!isSelectedServerOwner && !isSelectedServerModerator}
      joinSoundId={
        servers.find((server) => server.id === selectedServerId)?.joinSoundId ??
        null
      }
      onJoinSoundChange={(joinSoundId) =>
        setServers((current) =>
          current.map((server) =>
            server.id === selectedServerId
              ? { ...server, joinSoundId }
              : server,
          ),
        )
      }
      output={{ outputVolume, outputId, deafened }}
    />
  );
  const settingsOverlay = session &&
    (accountMenuOpen ||
      (serverSettingsOpen &&
        servers.some((server) => server.id === selectedServerId))) && (
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
            <SettingsNavigation
              canUploadSounds={!accountMenuOpen && isSelectedServerModerator}
              account={accountMenuOpen}
              owner={
                accountMenuOpen
                  ? session.user.role === "owner"
                  : isSelectedServerOwner
              }
              selected={
                accountMenuOpen
                  ? userSettingsSection
                  : isSelectedServerOwner
                    ? serverSettingsSection
                    : "join-sound"
              }
              onSelect={(id) => {
                if (id === "admin") {
                  window.open("/admin", "_blank", "noopener,noreferrer");
                  return;
                }
                if (id === "logout") {
                  void signOut({ callbackUrl: "/login" });
                  return;
                }
                if (accountMenuOpen) {
                  setUserSettingsSection(id);
                  if (id === "media") void loadMediaDevices();
                } else {
                  setServerSettingsSection(id);
                  if (id === "members" || id === "invite-friends")
                    void loadFriends();
                }
              }}
            />
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
                  <Avatar
                    name={session.user.name ?? "You"}
                    image={session.user.image}
                  />
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
                <ProfilePictureSettings
                  name={session.user.name ?? "You"}
                  image={session.user.image}
                  onSaved={async (image) => {
                    applyProfilePicture(session.user.id, image);
                    await updateSession();
                  }}
                />
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
            {userSettingsSection === "notifications" &&
              (notificationInbox.ready ? (
                <NotificationSettings
                  servers={servers}
                  friends={friends.filter(
                    (friend) => friend.status === "accepted",
                  )}
                  preferences={notificationInbox.preferences}
                  onSave={notificationInbox.save}
                />
              ) : (
                <p role="status">Loading notification settings…</p>
              ))}
            {userSettingsSection === "messages" && (
              <PersonalMessages currentServerId={selectedServerId} />
            )}
            {userSettingsSection === "delete-account" && (
              <AccountDeletion
                onDeleted={() => {
                  leaveRoom();
                  void signOut({ callbackUrl: "/login" });
                }}
              />
            )}
          </>
        ) : !isSelectedServerOwner ? (
          serverSoundSettings
        ) : (
          <>
            {serverSettingsSection === "overview" && (
              <>
                <h3>Server overview</h3>
                <ProfilePictureSettings
                  key={`picture:${selectedServerId}`}
                  kind="server"
                  endpoint={`/api/servers/${selectedServerId}/picture`}
                  name={
                    servers.find((server) => server.id === selectedServerId)
                      ?.name ?? "Server"
                  }
                  image={
                    servers.find((server) => server.id === selectedServerId)
                      ?.image
                  }
                  onSaved={async (image) => {
                    setServers((current) =>
                      current.map((server) =>
                        server.id === selectedServerId
                          ? { ...server, image }
                          : server,
                      ),
                    );
                    void serverInvitations.refresh();
                  }}
                />
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
                <ServerAfkSettings
                  key={`afk:${selectedServerId}`}
                  serverId={selectedServerId}
                  channelId={
                    servers.find((server) => server.id === selectedServerId)
                      ?.afkChannelId
                  }
                  channels={channels}
                  onSaved={(afkChannelId) => {
                    setServers((rows) =>
                      rows.map((server) =>
                        server.id === selectedServerId
                          ? { ...server, afkChannelId }
                          : server,
                      ),
                    );
                    void fetch(`/api/servers/${selectedServerId}/channels`)
                      .then((response) =>
                        response.ok ? response.json() : null,
                      )
                      .then((rows) => {
                        if (
                          selectedServerIdRef.current === selectedServerId &&
                          Array.isArray(rows)
                        )
                          setChannels(rows);
                      })
                      .catch(() => {});
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
                <h4>Channel list</h4>
                <ChannelManager
                  onReorder={moveChannel}
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
              </>
            )}
            {serverSettingsSection === "soundboard" && serverSoundSettings}
            {serverSettingsSection === "members" && (
              <SettingsMembers
                members={members}
                onRoleChange={async (member, role) => {
                  const response = await fetch(
                    `/api/servers/${selectedServerId}/members`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ userId: member.id, role }),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(
                      result.error ?? "The member's role could not be changed.",
                    );
                  if (selectedServerIdRef.current !== selectedServerId) return;
                  setMembers((current) =>
                    current.map((item) =>
                      item.id === member.id ? { ...item, role } : item,
                    ),
                  );
                  setNoticeMessage(
                    `${member.name} is now ${role === "mod" ? "a moderator" : "a member"}.`,
                  );
                }}
                onTransfer={async (member) => {
                  const response = await fetch(
                    `/api/servers/${selectedServerId}/ownership`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        userId: member.id,
                        confirm: true,
                      }),
                    },
                  );
                  const result = await response.json();
                  if (!response.ok)
                    throw new Error(
                      result.error ?? "Ownership could not be transferred.",
                    );
                  if (selectedServerIdRef.current !== selectedServerId) return;
                  setMembers((current) =>
                    current.map((item) =>
                      item.id === member.id
                        ? { ...item, role: "owner" }
                        : item.id === session.user.id
                          ? { ...item, role: "member" }
                          : item,
                    ),
                  );
                  setServers((current) =>
                    current.map((server) =>
                      server.id === selectedServerId
                        ? { ...server, role: "member" }
                        : server,
                    ),
                  );
                  setServerSettingsOpen(false);
                  setNoticeMessage(`${member.name} is now the server owner.`);
                }}
              />
            )}
            {(serverSettingsSection === "invite-friends" ||
              serverSettingsSection === "invite-people") && (
              <ServerInvites
                key={`${selectedServerId}-${serverSettingsSection}`}
                serverId={selectedServerId}
                mode={
                  serverSettingsSection === "invite-friends"
                    ? "friends"
                    : "people"
                }
                friends={friends}
                memberIds={members.map((member) => member.id)}
                pendingIds={serverInvitations.rows
                  .filter(
                    (invite) =>
                      !invite.incoming && invite.serverId === selectedServerId,
                  )
                  .map((invite) => invite.recipientId)}
                onSent={() => void serverInvitations.refresh()}
              />
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
    "--preferred-member-width":
      memberSidebarWidth === null ? undefined : `${memberSidebarWidth}px`,
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
  const memberSidebarResizer = (
    <SidebarResizer
      side="members"
      onResize={(width) => {
        setMemberSidebarWidth(width);
        localStorage.setItem("lc.memberSidebarWidth", String(width));
      }}
      onReset={() => {
        setMemberSidebarWidth(null);
        localStorage.removeItem("lc.memberSidebarWidth");
      }}
    />
  );
  const panelClasses = `${activeVoiceChannel ? "voiceActive" : ""} ${serverListToggled ? "serverListToggled" : ""} ${channelsHidden ? "channelsHidden" : ""} ${userListToggled ? "userListToggled" : ""}`;
  function handleHelpStep(step: number | null) {
    if (step === null) {
      const previous = helpPreviousView.current;
      helpPreviousView.current = null;
      if (!previous) return;
      if (
        previous.serverId &&
        servers.some((server) => server.id === previous.serverId)
      ) {
        void switchServer(previous.serverId);
        setSelectedChannelId(previous.channelId);
      } else if (!previous.serverId) {
        setSelectedServerId("");
        setSelectedChannelId(previous.channelId);
      }
      setFriendsView(previous.friends);
      setSelectedFriend(previous.friend);
      setCallViewOpen(previous.callView);
      return;
    }
    helpPreviousView.current ??= {
      friends: friendsView,
      friend: selectedFriend,
      callView: callViewOpen,
      serverId: selectedServerId,
      channelId: selectedChannelId,
    };
    if (step === 1) {
      setFriendsView(true);
      setSelectedFriend(null);
      setCallViewOpen(false);
    } else if ([2, 3, 4, 6, 8, 9].includes(step)) {
      const server =
        servers.find((server) => server.id === selectedServerId) ?? servers[0];
      if (server) {
        void switchServer(server.id);
        setFriendsView(false);
        setSelectedFriend(null);
        setCallViewOpen(false);
      }
    }
  }
  const helpTour = session?.user.id && (
    <HelpTour
      key={session.user.id}
      userId={session.user.id}
      requestKey={helpRequest}
      onStepChange={handleHelpStep}
      profile={{
        name: session.user.name ?? "You",
        status: statusLabels[userStatus],
        statusCode: userStatus,
      }}
    />
  );
  const panelControls = (
    <nav className="panelControls" aria-label="Workspace panels">
      <PanelToggle
        label="servers"
        toggled={serverListToggled}
        defaultHiddenBelow={650}
        onToggle={() => setServerListToggled((value) => !value)}
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
      </PanelToggle>
      <PanelToggle
        label={friendsView ? "messages" : "channels"}
        toggled={channelsHidden}
        onToggle={() => setChannelsHidden((value) => !value)}
      >
        #
      </PanelToggle>
      <PanelToggle
        label={friendsView ? "profile" : "users"}
        toggled={userListToggled}
        defaultHiddenBelow={920}
        onToggle={() => setUserListToggled((value) => !value)}
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
      </PanelToggle>
    </nav>
  );
  const closeUserList = (
    <button
      type="button"
      className="closeUserList"
      aria-label={friendsView ? "Hide profile" : "Hide users"}
      title={friendsView ? "Hide profile" : "Hide users"}
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
            Delete permanently
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

  async function publishDirectSound(track: MediaStreamTrack) {
    const sender = soundboardSender.current;
    if (!sender || !connection.current)
      throw new Error("Call is not connected");
    await sender.replaceTrack(track);
    await preferSharedAudio(sender);
    return () => {
      if (sender.track === track)
        void sender.replaceTrack(null).catch(() => {});
    };
  }
  const directSoundboard = (
    <SoundboardButton
      board={soundboard}
      serverId={activeVoiceChannel?.serverId}
      serverName={activeVoiceChannel?.serverName}
      disabled={!voiceReady}
      publish={publishDirectSound}
    />
  );

  const currentVoiceSessionId = voiceSessionId.current;
  const groupCall = session && activeVoiceChannel?.type === "voice_group" && (
    <GroupCall
      key={`${activeVoiceChannel.id}-${voiceJoinKey}`}
      channelId={activeVoiceChannel.id}
      sessionId={currentVoiceSessionId}
      serverId={activeVoiceChannel.serverId}
      serverName={activeVoiceChannel.serverName}
      currentUserName={session.user.name ?? "You"}
      cameraResolution={cameraResolution}
      onCameraResolutionChange={(value) => void changeCameraResolution(value)}
      cameraFrameRate={cameraFrameRate}
      onCameraFrameRateChange={(value) => void changeCameraFrameRate(value)}
      focusTarget={mediaFocusTarget}
      currentUserId={session.user.id}
      microphoneId={microphoneId}
      cameraId={cameraId}
      initialMuted={microphoneMuted}
      deafened={deafened}
      outputVolume={outputVolume / 100}
      participantAudio={participantAudio.values}
      serverPolicy={ownVoicePolicy}
      onVoicePolicies={(serverId, policies) => {
        setVoicePolicies((current) => ({
          ...current,
          [`${session.user.id}:${serverId}`]: policies,
        }));
        setServers((current) =>
          current.map((server) =>
            server.id === serverId
              ? { ...server, ...policies[session.user.id] }
              : server,
          ),
        );
      }}
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
        handleGroupConnection(
          activeVoiceChannel.id,
          present,
          currentVoiceSessionId,
        )
      }
      onMediaStateChange={(media) => {
        if (media.microphoneSpeaking) recordIdleActivity();
        if (activeGroupChannelId.current !== activeVoiceChannel.id) return;
        if (!deafened) setMuted(media.muted);
        sendGroupPresence(
          activeVoiceChannel.id,
          true,
          presenceSocket.current,
          media,
          currentVoiceSessionId,
        );
      }}
      onPingChange={(ping) =>
        setChannelPing((current) => ({
          ...current,
          [activeVoiceChannel.id]: ping,
        }))
      }
      onDiagnosticsChange={setCallDiagnostics}
      onLeave={() => handleGroupLeave(currentVoiceSessionId)}
      onReconnect={() =>
        sendGroupPresence(
          activeVoiceChannel.id,
          true,
          presenceSocket.current,
          groupMediaRef.current,
          currentVoiceSessionId,
          true,
        )
      }
      onError={(message) => {
        if (pendingVoiceChannel.current === activeVoiceChannel.id)
          updatePendingVoice(activeVoiceChannel.id, false);
        setErrorMessage(message);
      }}
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

  const messageContextDropdown = messageMenu && (
    <div
      className="messageContextMenu"
      ref={messageContextMenu}
      role="menu"
      style={{ left: messageMenu.x, top: messageMenu.y }}
    >
      {!messageMenu.message.deleted && messageMenu.message.kind !== "call" && (
        <MessageReactionMenu
          accountId={session.user.id}
          key={messageMenu.message.id}
          messageId={messageMenu.message.id}
          reactions={
            (messageMenu.conversationUserId
              ? directReactions
              : channelReactions
            ).data[messageMenu.message.id]
          }
          channelId={
            messageMenu.conversationUserId ? undefined : selectedChannelId
          }
          userId={messageMenu.conversationUserId}
          onRefresh={
            (messageMenu.conversationUserId
              ? directReactions
              : channelReactions
            ).refresh
          }
          onDone={() => {
            const id = messageMenu.message.id;
            setMessageMenu((current) =>
              current?.message.id === id ? null : current,
            );
          }}
        />
      )}
      {!messageMenu.conversationUserId && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setEditingMessage(null);
            setReplyingTo(messageMenu.message);
            setMessageMenu(null);
          }}
        >
          Reply
        </button>
      )}
      {messageMenu.message.authorId === session.user.id &&
        !messageMenu.message.deleted &&
        messageMenu.message.kind !== "call" && (
          <button
            type="button"
            role="menuitem"
            disabled={sendingMessage}
            onClick={() => {
              setEditingMessage({
                key: composerKey,
                message: messageMenu.message,
                userId: messageMenu.conversationUserId,
                channelId: messageMenu.conversationUserId
                  ? undefined
                  : selectedChannelId,
              });
              setEditDraft(messageMenu.message.text);
              setMessageMenu(null);
            }}
          >
            Edit message
          </button>
        )}
      {messageMenu.message.authorId === session.user.id && (
        <button
          className="danger"
          type="button"
          role="menuitem"
          onClick={() =>
            requestMessageDeletion(
              messageMenu.message.id,
              messageDeletionPreview(messageMenu.message),
              messageMenu.conversationUserId,
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
  );

  const noticeToast = noticeMessage && (
    <div className="noticeToast" role="status">
      <span>{noticeMessage}</span>
      <button
        aria-label="Dismiss confirmation"
        onClick={() => setNoticeMessage("")}
      >
        ×
      </button>
    </div>
  );
  const voiceTransferDialog = voiceTransferOpen && (
    <VoiceTransferDialog onClose={() => setVoiceTransferOpen(false)} />
  );
  const errorToast = errorMessage && (
    <div className="errorToast" role="alert">
      <span>{errorMessage}</span>
      <button aria-label="Dismiss error" onClick={() => setErrorMessage("")}>
        ×
      </button>
    </div>
  );

  const managementOverlays = (
    <>
      {leaveServerTarget && (
        <ServerLeaveConfirmation
          server={leaveServerTarget}
          onConfirm={leaveServer}
          onClose={() => setLeaveServerTarget(null)}
        />
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
              {renameTarget.kind === "user" ? "username" : renameTarget.kind}
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
        <div className="modalBackdrop" onMouseDown={closeForm}>
          <form
            className="modalCard"
            onSubmit={form === "server" ? createServer : createChannel}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>{form === "server" ? "Create server" : "Create channel"}</h2>
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
            {form === "server" && (
              <label>
                <input
                  type="checkbox"
                  checked={createAfk}
                  onChange={(event) => setCreateAfk(event.target.checked)}
                />
                Create an AFK voice channel (move inactive users after 15
                minutes)
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
            <div className="modalActions">
              <button type="button" onClick={closeForm}>
                Cancel
              </button>
              <button className="primary" type="submit">
                Create
              </button>
            </div>
          </form>
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
                  Delete permanently
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
    </>
  );

  const searchContextNotice = activeContext && (
    <div className="searchContextNotice">
      <span>Viewing surrounding messages from a search result</span>
    </div>
  );

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
        help={helpTour}
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
            <ReorderStatus drag={serverDrag} />
            {servers.map((server) => (
              <ServerNavButton
                key={server.id}
                server={server}
                drag={serverDrag}
                active={false}
                unread={unreadServerIds.has(server.id)}
                mentions={serverMentionCounts[server.id] ?? 0}
                voiceUsers={serverVoiceUsers(
                  server.id,
                  workspaceActivity.channels,
                  voicePresence,
                )}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setServerContext({
                    server,
                    x: Math.min(event.clientX, window.innerWidth - 200),
                    y: Math.max(
                      8,
                      Math.min(event.clientY, window.innerHeight - 210),
                    ),
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
              />
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
              onClick={() => {
                setSelectedFriend(null);
                openFriendsHome();
              }}
            >
              {selectedFriend ? "Back to Friends" : "Friends"}
            </button>
          </header>
          <nav>
            {recentFriends.map((friend) => (
              <button
                className={`channel ${selectedFriend?.id === friend.id ? "active" : ""} ${notificationsEnabled && (visibleDirectCounts[friend.id] ?? 0) > 0 ? "unread" : ""}`}
                key={friend.id}
                onClick={() => openFriend(friend)}
                onContextMenu={(event) =>
                  openNotificationMute(event, "direct", friend)
                }
              >
                <span className="friendConversationTitle">
                  <Avatar name={friend.name} image={friend.image} />
                  <i
                    className={`statusDot status-${userStatuses[friend.id] ?? "offline"}`}
                    title={
                      onlineUserIds.includes(friend.id)
                        ? statusLabels[userStatuses[friend.id] ?? "online"]
                        : "Offline"
                    }
                  />
                  <b>{friend.name}</b>
                  {friend.lastActivityAt && (
                    <time>
                      {new Date(friend.lastActivityAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  )}
                </span>
                {friend.lastMessage && (
                  <small>
                    {friend.lastMessage.senderId === session.user.id
                      ? "You: "
                      : ""}
                    {friend.lastMessage.text}
                  </small>
                )}
                {notificationsEnabled &&
                  (visibleDirectCounts[friend.id] ?? 0) > 0 && (
                    <span className="conversationUnreadBadge">
                      {visibleDirectCounts[friend.id]}
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
            {selectedFriend && (
              <ConversationSearch
                key={composerKey}
                userId={selectedFriend.id}
                onResult={showSearchResult}
              />
            )}
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
                  {incomingFriendRequestCount + incomingServerInvitationCount >
                    0 && (
                    <span className="tabBadge">
                      {incomingFriendRequestCount +
                        incomingServerInvitationCount}
                    </span>
                  )}
                </button>
              </div>
              {friendTab === "pending" ? (
                <>
                  <p className="sectionLabel">PENDING INVITES</p>
                  {pendingRequests.length === 0 &&
                    serverInvitations.ready &&
                    serverInvitations.rows.length === 0 &&
                    !serverInvitations.error && (
                      <EmptyState
                        title="No pending invites"
                        description="Friend requests and server invitations you send or receive will appear here."
                      />
                    )}
                  {[true, false].map((incoming) => (
                    <section
                      className="pendingInviteGroup"
                      aria-label={
                        incoming
                          ? "Incoming pending invites"
                          : "Outgoing pending invites"
                      }
                      key={String(incoming)}
                    >
                      <h3>{incoming ? "Incoming" : "Outgoing"}</h3>
                      {serverInvitations.ready &&
                        !serverInvitations.error &&
                        !serverInvitations.rows.some(
                          (invite) => invite.incoming === incoming,
                        ) &&
                        !pendingRequests.some(
                          (friend) => friend.incoming === incoming,
                        ) && (
                          <p className="settingsDescription">
                            No {incoming ? "incoming" : "outgoing"} pending
                            invites.
                          </p>
                        )}
                      <PendingServerInvitations
                        invitations={serverInvitations}
                        incoming={incoming}
                      />
                      {pendingRequests
                        .filter((friend) => friend.incoming === incoming)
                        .map((friend) => (
                          <div className="friendRow" key={friend.id}>
                            <span>
                              <b>{friend.name}</b>
                              <small>{formatUserHandle(friend.handle)}</small>
                            </span>
                            {friend.incoming ? (
                              <>
                                <button
                                  onClick={() =>
                                    void friendAction("accept", friend)
                                  }
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={() =>
                                    void friendAction("decline", friend)
                                  }
                                >
                                  Decline
                                </button>
                              </>
                            ) : (
                              <small>Sent</small>
                            )}
                          </div>
                        ))}
                    </section>
                  ))}
                </>
              ) : (
                <>
                  <p className="sectionLabel">{friendTab.toUpperCase()}</p>
                  {visibleFriends.length === 0 && (
                    <EmptyState
                      title={
                        friendTab === "online"
                          ? "No friends online right now"
                          : "No offline friends"
                      }
                      description={
                        friendTab === "online"
                          ? "When your friends come online, you’ll find them here. You can also search for someone to add."
                          : "Friends who are offline will appear here. Everyone may already be online."
                      }
                    />
                  )}
                  {visibleFriends.map((friend) => (
                    <button
                      type="button"
                      className="friendRow"
                      data-status={userStatuses[friend.id] ?? "offline"}
                      key={friend.id}
                      onClick={() => setProfileUser(friend)}
                      onContextMenu={(event) =>
                        openNotificationMute(event, "direct", friend)
                      }
                    >
                      <StatusAvatar
                        name={friend.name}
                        image={friend.image}
                        status={userStatuses[friend.id] ?? "offline"}
                      />
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
          {selectedFriend && (!callViewOpen || conversationCallActive) && (
            <section
              className={`chat directMessages ${conversationCallActive ? "callActive" : ""} ${incomingCall?.fromUserId === selectedFriend.id ? "hasIncomingCall" : ""}`}
            >
              <IncomingCallNotice
                call={incomingCall}
                status={callsNotificationAllowed ? userStatus : "dnd"}
                conversationUserId={selectedFriend.id}
                inline
                onAnswer={answerIncomingCall}
                onDecline={declineIncomingCall}
              />
              <ChatHistory
                key={`${selectedFriend.id}:${activeContext?.targetId ?? "latest"}`}
                threadId={`${selectedFriend.id}:${activeContext?.targetId ?? "latest"}`}
                focusMessageId={
                  activeContext?.targetId ?? conversationUnreadId ?? undefined
                }
                firstUnreadId={
                  !activeContext ? conversationUnreadId : undefined
                }
                onLatestVisibilityChange={updateLatestVisibility}
                contextNotice={searchContextNotice}
                onJumpToPresent={
                  activeContext ? () => setHistoryContext(null) : undefined
                }
                messages={shownDirectMessages}
                ready={
                  !!activeContext || directHistoryLoaded === selectedFriend.id
                }
                hasMore={!activeContext && Boolean(directMessageCursor)}
                loadingOlder={loadingOlderDirect}
                onLoadOlder={loadOlderDirectMessages}
                ownUserId={session.user.id}
              >
                {directHistoryLoaded === selectedFriend.id &&
                  directMessages.length === 0 && (
                    <EmptyState
                      title={`Start a conversation with ${selectedFriend.name}`}
                      description="Send the first message to get things started."
                    />
                  )}
                {shownDirectMessages.map((message) => (
                  <article
                    className={`${message.authorId === session.user.id ? "messageOwn" : "messageOther"} ${message.kind === "call" ? "callHistory" : ""} ${message.deleted ? "deletedMessage" : ""}`}
                    key={message.id}
                    data-message-id={message.id}
                    data-search-match={
                      activeContext?.targetId === message.id || undefined
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (
                        message.authorId !== session.user.id &&
                        (message.deleted || message.kind === "call")
                      ) {
                        setMessageMenu(null);
                        return;
                      }
                      setMessageMenu({
                        message,
                        conversationUserId: selectedFriend.id,
                        x: Math.max(
                          0,
                          Math.min(event.clientX, window.innerWidth - 190),
                        ),
                        y: Math.max(
                          0,
                          Math.min(event.clientY, window.innerHeight - 190),
                        ),
                      });
                    }}
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
                          image={userImage(
                            message.authorId,
                            message.authorImage,
                          )}
                          edited={!!message.editedAt && !message.deleted}
                          editedByAdmin={message.editedByAdmin}
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
                        <MessageAttachments
                          files={message.attachments}
                          deleted={message.deleted}
                        />
                        {!message.deleted && message.kind !== "call" && (
                          <MessageReactions
                            accountId={session.user.id}
                            messageId={message.id}
                            reactions={directReactions.data[message.id]}
                            userId={selectedFriend.id}
                            onRefresh={directReactions.refresh}
                          />
                        )}
                      </>
                    )}
                  </article>
                ))}
              </ChatHistory>
              {directReactions.error && (
                <small className="reactionError" role="status">
                  {directReactions.error}
                </small>
              )}
              <div className="typingIndicator" role="status" aria-live="polite">
                {typing.label}
              </div>
              <form onSubmit={sendDirectMessage}>
                <MessageComposer
                  key={composerKey}
                  onTyping={activeEdit ? undefined : typing.change}
                  value={activeEdit ? editDraft : draft}
                  onChange={activeEdit ? setEditDraft : setDraft}
                  editId={activeEdit?.message.id}
                  onCancelEdit={() => setEditingMessage(null)}
                  files={activeEdit ? [] : files}
                  onFiles={changeFiles}
                  busy={sendingMessage}
                  progress={uploadProgress}
                  placeholder={`Message ${selectedFriend.name}`}
                />
                <button
                  data-chat-send
                  disabled={sendingMessage || messageCooldown.seconds > 0}
                  title={
                    messageCooldown.seconds
                      ? "Message limit reached. Please wait before sending again."
                      : undefined
                  }
                >
                  {messageCooldown.seconds
                    ? `Wait ${messageCooldown.seconds}s`
                    : activeEdit
                      ? "Edit"
                      : "Send"}
                </button>
                <button
                  type="button"
                  data-chat-jump-target
                  onClick={() =>
                    conversationCallActive
                      ? endFriendCall()
                      : incomingCall?.fromUserId === selectedFriend.id
                        ? answerIncomingCall()
                        : void startFriendCall(selectedFriend)
                  }
                >
                  {conversationCallActive
                    ? "End call"
                    : incomingCall?.fromUserId === selectedFriend.id
                      ? "Answer"
                      : "Call"}
                </button>
              </form>
            </section>
          )}
          {activeVoiceChannel?.type === "voice_direct" && (
            <section
              className={`friendsCallPanel ${showFriendsCallMedia ? "" : "controlsOnly"}`}
              aria-live="polite"
            >
              <div className="friendsCallIdentity">
                <small>
                  {isFriendCall(activeVoiceChannel.id)
                    ? joined
                      ? "Direct call"
                      : "Calling"
                    : "Server voice"}
                </small>
                <strong
                  className={
                    showParticipantSpeaking(
                      {
                        userId: directPeerUserId ?? undefined,
                        speaking: directRemoteSpeaking,
                      },
                      session.user.id,
                      deafened,
                      participantAudio.values[directPeerUserId ?? ""],
                    )
                      ? "speaking"
                      : ""
                  }
                >
                  {activeVoiceChannel.name}
                </strong>
                <span>{joining ? "Connecting…" : status}</span>
              </div>
              <div className="videoGrid friendsParticipantGrid">
                <div
                  className={`videoCard ${remoteScreenSharing ? "screenShare" : !remoteHasVideo ? "nameOnly" : ""} ${!callPeerPresent || hiddenDirectTiles.includes(remoteDirectTileId) ? "videoHidden" : ""}`}
                  onDoubleClick={(event) =>
                    fullscreenVideoTile(event.currentTarget)
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
                  {remoteHasVideo && (
                    <StreamInfo
                      quality={remoteVideoQuality}
                      stats={directionalStreamStats(directVideoStats, "down")}
                      name={directRemoteLabel}
                    />
                  )}
                  <HideTileButton
                    label={directRemoteLabel}
                    onHide={() => hideDirectTile(remoteDirectTileId)}
                  />
                  {remoteScreenSharing && (
                    <StreamVolume
                      volume={streamVolume}
                      onChange={setStreamVolume}
                    />
                  )}
                  <span>
                    {directRemoteName}
                    {remoteScreenSharing ? " — screen" : ""}
                  </span>
                </div>
                <div
                  className={`videoCard ${screenSharing ? "screenShare" : cameraOff ? "nameOnly" : ""} ${hiddenDirectTiles.includes(localDirectTileId) ? "videoHidden" : ""}`}
                  onDoubleClick={(event) =>
                    fullscreenVideoTile(event.currentTarget)
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
                  {(screenSharing || !cameraOff) && (
                    <StreamInfo
                      quality={localVideoQuality}
                      stats={directionalStreamStats(directVideoStats, "up")}
                      name={directLocalLabel}
                    />
                  )}
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
                  actionUnavailable={deafened || voiceBlocked(ownVoicePolicy)}
                  extraOptions={audioDeviceOptions}
                  unavailable={!voiceReady}
                  disabled={muted}
                  devices={microphones}
                  selectedId={microphoneId}
                  onAction={toggleAudio}
                  onSelect={(deviceId) => void changeActiveMicrophone(deviceId)}
                />
                <DeviceMenu
                  kind="camera"
                  extraOptions={cameraResolutionOptions}
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
                {directSoundboard}
              </div>
            </section>
          )}
        </section>
        <aside className="memberSidebar friendsInfoSidebar">
          {memberSidebarResizer}
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
                <Avatar
                  name={selectedFriend.name}
                  image={userImage(selectedFriend.id, selectedFriend.image)}
                />
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
        {compactLegalLinks}
        {settingsOverlay}
        {profileOverlay}
        {screenShareOptionsOpen &&
          activeVoiceChannel?.type === "voice_direct" &&
          voiceReady && (
            <ScreenShareOptions
              onClose={() => setScreenShareOptionsOpen(false)}
              onShare={(resolution, frameRate) =>
                void toggleScreenShare(resolution, frameRate)
              }
            />
          )}
        {serverContextMenu}
        {notificationMuteMenu}
        {messageContextDropdown}
        {directDeletionDialog}
        {managementOverlays}
        {noticeToast}
        {voiceTransferDialog}
        {errorToast}
      </WorkspaceShell>
    );
  }

  if (serversLoaded && servers.length === 0) {
    return (
      <WorkspaceShell call={groupCall} help={helpTour} className="noServerPage">
        {legalLinks}
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
                <label>
                  <input
                    type="checkbox"
                    checked={createAfk}
                    onChange={(event) => setCreateAfk(event.target.checked)}
                  />
                  Create an AFK voice channel (15 minutes)
                </label>
              </form>
            </>
          )}
          <button onClick={() => void signOut({ callbackUrl: "/login" })}>
            Log out
          </button>
        </section>
        {incomingCallOverlay}
        {noticeToast}
        {voiceTransferDialog}
        {errorToast}
        {legalOverlay}
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      call={groupCall}
      help={helpTour}
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
          <ReorderStatus drag={serverDrag} />
          {servers.map((server) => (
            <ServerNavButton
              key={server.id}
              server={server}
              drag={serverDrag}
              active={server.id === selectedServerId}
              unread={unreadServerIds.has(server.id)}
              mentions={serverMentionCounts[server.id] ?? 0}
              voiceUsers={serverVoiceUsers(
                server.id,
                workspaceActivity.channels,
                voicePresence,
              )}
              onContextMenu={(event) => {
                event.preventDefault();
                setServerContext({
                  server,
                  x: Math.min(event.clientX, window.innerWidth - 200),
                  y: Math.max(
                    8,
                    Math.min(event.clientY, window.innerHeight - 210),
                  ),
                });
              }}
              onClick={() => {
                if (server.id !== selectedServerId)
                  void switchServer(server.id);
              }}
            />
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
            <button
              type="button"
              className="serverInviteButton"
              title="Invite to server"
              aria-label="Invite to server"
              aria-haspopup="dialog"
              onClick={() => {
                setServerSettingsSection("invite-friends");

                setServerSettingsOpen(true);
              }}
            >
              <svg
                aria-hidden="true"
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="9" cy="7" r="4" />
                <path d="M2 21v-3a7 7 0 0 1 14 0v3M19 8v8m-4-4h8" />
              </svg>
            </button>
          )}
          {selectedServerId &&
            servers.some((server) => server.id === selectedServerId) && (
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
                    setServerSettingsSection(
                      isSelectedServerOwner ? "overview" : "join-sound",
                    );
                    setFormName("");

                    setServerSettingsOpen((current) => !current);
                  }}
                >
                  <SettingsIcon />
                </button>
              </div>
            )}
        </header>
        <nav>
          <ReorderStatus drag={channelDrag} />
          <p className="sectionLabel">TEXT CHANNELS</p>
          {serverChannelsLoaded !== selectedServerId && (
            <LoadingSkeleton kind="channels" />
          )}
          {channels
            .filter((channel) => channel.type === "text")
            .map((channel) => (
              <div
                key={channel.id}
                className="channelRow"
                {...channelDrag.itemProps(channel.id)}
                onContextMenu={(event) => openChannelContext(event, channel)}
              >
                {isSelectedServerOwner && (
                  <ReorderHandle drag={channelDrag} id={channel.id} />
                )}
                <button
                  {...channelDrag.pointerProps(channel.id)}
                  className={`channel ${!callViewOpen && channel.id === selectedChannelId ? "active" : ""}`}
                  title={channel.name}
                  onClick={() => selectTextChannel(channel.id)}
                >
                  <span
                    className={`channelName ${channelUnread[channel.id] || channelMentionCounts[channel.id] ? "channelUnread" : ""}`}
                  >
                    {channel.name}
                  </span>
                  <UnreadIndicator
                    unread={channelUnread[channel.id]}
                    mentions={channelMentionCounts[channel.id] ?? 0}
                  />
                </button>
              </div>
            ))}
          <p className="sectionLabel">VOICE CHANNELS</p>
          {channels
            .filter((channel) => channel.type !== "text")
            .map((channel) => (
              <div
                key={channel.id}
                className="voiceChannel"
                {...channelDrag.itemProps(channel.id)}
                onContextMenu={(event) => {
                  if ((event.target as Element).closest(".voiceParticipant"))
                    return;
                  openChannelContext(event, channel);
                }}
              >
                {isSelectedServerOwner && (
                  <ReorderHandle drag={channelDrag} id={channel.id} />
                )}
                <button
                  {...channelDrag.pointerProps(channel.id)}
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
                    {alphabeticalParticipants(voicePresence[channel.id]).map(
                      (participant, index) => {
                        const serverPolicy = participant.userId
                          ? (voicePolicies[
                              `${session.user.id}:${channel.serverId}`
                            ]?.[participant.userId] ??
                            members.find(
                              (member) => member.id === participant.userId,
                            ))
                          : undefined;
                        return (
                          <span
                            className={`voiceParticipant ${channel.id === activeVoiceChannelId && showParticipantSpeaking(participant, session.user.id, deafened, participantAudio.values[participant.userId ?? ""], serverPolicy) ? "speaking" : ""}`}
                            key={
                              participant.userId ??
                              `${participant.name}-${index}`
                            }
                            onContextMenu={(event) => {
                              if (
                                !participant.userId ||
                                participant.connecting ||
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
                                  image: userImage(participant.userId),
                                })
                              }
                            >
                              <Avatar
                                name={participant.name}
                                image={userImage(participant.userId)}
                                small
                              />
                              <b title={participant.name}>{participant.name}</b>
                              <SoundboardIndicator
                                playing={participant.soundboard}
                              />
                              {participant.connecting && (
                                <small
                                  className="voiceConnectingLabel"
                                  role="status"
                                >
                                  Connecting…
                                </small>
                              )}
                            </button>
                            <span className="voiceParticipantControls">
                              <LocallyMuted
                                serverPolicy={serverPolicy}
                                deafened={Boolean(
                                  participant.userId &&
                                  participantAudio.values[participant.userId]
                                    ?.deafened,
                                )}
                                muted={
                                  participant.userId
                                    ? participantAudio.values[
                                        participant.userId
                                      ]?.muted
                                    : false
                                }
                              />
                              <ParticipantMediaIndicators
                                participant={participant}
                                serverPolicy={serverPolicy}
                                selfState={
                                  participant.userId === session.user.id
                                    ? { muted, deafened }
                                    : undefined
                                }
                                showCamera={
                                  channel.type === "voice_group" ||
                                  !participant.screen
                                }
                                onCamera={() =>
                                  openParticipantMedia(
                                    channel,
                                    participant,
                                    "camera",
                                  )
                                }
                                onWatch={() =>
                                  openParticipantMedia(
                                    channel,
                                    participant,
                                    "screen",
                                  )
                                }
                              />
                            </span>
                          </span>
                        );
                      },
                    )}
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
          {selectedChannel?.type === "text" && (
            <ConversationSearch
              key={composerKey}
              channelId={selectedChannelId}
              onResult={showSearchResult}
            />
          )}
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
                onDoubleClick={(event) =>
                  fullscreenVideoTile(event.currentTarget)
                }
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
                {(screenSharing || !cameraOff) && (
                  <StreamInfo
                    quality={localVideoQuality}
                    stats={directionalStreamStats(directVideoStats, "up")}
                    name={directLocalLabel}
                  />
                )}
              </div>
              <div
                className={`videoCard remote ${remoteScreenSharing ? "screenShare" : !remoteHasVideo ? "nameOnly" : ""} ${!callPeerPresent || hiddenDirectTiles.includes(remoteDirectTileId) || (focusedDirectVideo && focusedDirectVideo !== "remote") ? "videoHidden" : ""}`}
                onDoubleClick={(event) =>
                  fullscreenVideoTile(event.currentTarget)
                }
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
                {remoteScreenSharing && (
                  <StreamVolume
                    volume={streamVolume}
                    onChange={setStreamVolume}
                  />
                )}
                <span>
                  {directRemoteName}
                  {remoteScreenSharing ? " — screen" : ""}
                </span>
                {remoteHasVideo && (
                  <StreamInfo
                    quality={remoteVideoQuality}
                    stats={directionalStreamStats(directVideoStats, "down")}
                    name={directRemoteLabel}
                  />
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
                    onClick={() => fullscreenVideoTile(directVideoGrid.current)}
                  >
                    Fullscreen
                  </button>
                </div>
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
                actionUnavailable={deafened || voiceBlocked(ownVoicePolicy)}
                extraOptions={audioDeviceOptions}
                unavailable={!voiceReady}
                disabled={muted}
                devices={microphones}
                selectedId={microphoneId}
                onAction={toggleAudio}
                onSelect={(deviceId) => void changeActiveMicrophone(deviceId)}
              />
              <DeviceMenu
                kind="camera"
                extraOptions={cameraResolutionOptions}
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
              {directSoundboard}
            </div>
            {mediaNotice && <p className="mediaNotice">{mediaNotice}</p>}
          </section>
        )}
        {selectedChannel?.type === "text" && !callViewOpen && (
          <section className="chat">
            <ChatHistory
              key={`${selectedChannelId}:${activeContext?.targetId ?? "latest"}`}
              threadId={`${selectedChannelId}:${activeContext?.targetId ?? "latest"}`}
              focusMessageId={
                activeContext?.targetId ?? conversationUnreadId ?? undefined
              }
              firstUnreadId={!activeContext ? conversationUnreadId : undefined}
              onLatestVisibilityChange={updateLatestVisibility}
              contextNotice={searchContextNotice}
              onJumpToPresent={
                activeContext ? () => setHistoryContext(null) : undefined
              }
              messages={shownChannelMessages}
              ready={
                !!activeContext || channelHistoryLoaded === selectedChannelId
              }
              hasMore={!activeContext && Boolean(nextMessageCursor)}
              loadingOlder={loadingMoreMessages}
              onLoadOlder={loadMoreMessages}
              ownUserId={session.user.id}
            >
              {channelHistoryLoaded === selectedChannelId &&
                messages.length === 0 && (
                  <EmptyState
                    title={
                      selectedChannelId
                        ? "The conversation starts here"
                        : "Choose a text channel"
                    }
                    description={
                      selectedChannelId
                        ? "This channel has no messages yet. Send the first one."
                        : "Create or select a channel to begin."
                    }
                  />
                )}
              {shownChannelMessages.map((message) => (
                <article
                  className={`${message.authorId === session.user.id ? "messageOwn" : "messageOther"} ${message.deleted ? "deletedMessage" : ""}`}
                  key={message.id}
                  data-message-id={message.id}
                  data-mentioned={
                    (!message.deleted &&
                      message.mentions?.some(
                        (mention) => mention.userId === session.user.id,
                      )) ||
                    undefined
                  }
                  data-search-match={
                    activeContext?.targetId === message.id || undefined
                  }
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMessageMenu({
                      message,
                      x: Math.min(event.clientX, window.innerWidth - 190),
                      y: Math.max(
                        0,
                        Math.min(event.clientY, window.innerHeight - 190),
                      ),
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
                    image={userImage(message.authorId, message.authorImage)}
                    edited={!!message.editedAt && !message.deleted}
                    editedByAdmin={message.editedByAdmin}
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
                  <p>
                    <MentionText
                      text={message.text}
                      mentions={message.deleted ? [] : message.mentions}
                      onProfile={setProfileUser}
                    />
                  </p>
                  <MessageAttachments
                    files={message.attachments}
                    deleted={message.deleted}
                  />
                  {!message.deleted && (
                    <MessageReactions
                      accountId={session.user.id}
                      messageId={message.id}
                      reactions={channelReactions.data[message.id]}
                      channelId={selectedChannelId}
                      onRefresh={channelReactions.refresh}
                    />
                  )}
                </article>
              ))}
            </ChatHistory>
            {channelReactions.error && (
              <small className="reactionError" role="status">
                {channelReactions.error}
              </small>
            )}
            <div className="typingIndicator" role="status" aria-live="polite">
              {typing.label}
            </div>
            <form onSubmit={submit}>
              <MessageComposer
                key={composerKey}
                onTyping={activeEdit ? undefined : typing.change}
                mentionMembers={members.filter(
                  (member) => member.id !== session.user.id,
                )}
                value={activeEdit ? editDraft : draft}
                onChange={activeEdit ? setEditDraft : setDraft}
                editId={activeEdit?.message.id}
                onCancelEdit={() => setEditingMessage(null)}
                files={activeEdit ? [] : files}
                onFiles={changeFiles}
                busy={sendingMessage}
                progress={uploadProgress}
                disabled={!selectedChannelId}
                placeholder={
                  selectedChannel
                    ? `Message #${selectedChannel.name}`
                    : "Select a text channel"
                }
              >
                {!activeEdit && replyingTo && (
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
              </MessageComposer>
              <button
                data-chat-send
                disabled={
                  sendingMessage ||
                  !selectedChannelId ||
                  messageCooldown.seconds > 0
                }
                title={
                  messageCooldown.seconds
                    ? "Message limit reached. Please wait before sending again."
                    : undefined
                }
              >
                {messageCooldown.seconds
                  ? `Wait ${messageCooldown.seconds}s`
                  : activeEdit
                    ? "Edit"
                    : "Send"}
              </button>
            </form>
          </section>
        )}
      </section>
      <aside className="memberSidebar">
        {memberSidebarResizer}
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
                if (
                  !(isSelectedServerOwner && member.role !== "owner") &&
                  !friends.some(
                    (friend) =>
                      friend.id === member.id && friend.status === "accepted",
                  )
                )
                  return;
                event.preventDefault();
                setMemberMenu({
                  member,
                  x: Math.min(event.clientX, window.innerWidth - 190),
                  y: Math.min(event.clientY, window.innerHeight - 70),
                });
              }}
            >
              <StatusAvatar
                name={member.name}
                image={member.image}
                status={userStatuses[member.id] ?? "online"}
                className={`role-${member.role}`}
              />
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
                if (
                  !(isSelectedServerOwner && member.role !== "owner") &&
                  !friends.some(
                    (friend) =>
                      friend.id === member.id && friend.status === "accepted",
                  )
                )
                  return;
                event.preventDefault();
                setMemberMenu({
                  member,
                  x: Math.min(event.clientX, window.innerWidth - 190),
                  y: Math.min(event.clientY, window.innerHeight - 70),
                });
              }}
            >
              <StatusAvatar
                name={member.name}
                image={member.image}
                status="offline"
                className={`role-${member.role}`}
              />
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
      {screenShareOptionsOpen &&
        activeVoiceChannel?.type === "voice_direct" &&
        voiceReady && (
          <ScreenShareOptions
            onClose={() => setScreenShareOptionsOpen(false)}
            onShare={(resolution, frameRate) =>
              void toggleScreenShare(resolution, frameRate)
            }
          />
        )}
      {serverContextMenu}
      {notificationMuteMenu}
      {channelContextMenu}
      {memberMenu && (
        <VoiceParticipantMenu
          key={memberMenu.member.id}
          x={memberMenu.x}
          y={memberMenu.y}
          channels={[]}
          onClose={() => setMemberMenu(null)}
          onKick={() => {}}
          onMove={() => {}}
          showVoiceActions={false}
          canModerate={
            isSelectedServerOwner &&
            memberMenu.member.role !== "owner" &&
            memberMenu.member.id !== session.user.id
          }
          audio={participantAudio.values[memberMenu.member.id]}
          onAudioChange={
            memberMenu.member.id !== session.user.id
              ? (patch) => participantAudio.change(memberMenu.member.id, patch)
              : undefined
          }
          serverPolicy={
            voicePolicies[`${session.user.id}:${selectedServerId}`]?.[
              memberMenu.member.id
            ] ?? members.find((person) => person.id === memberMenu.member.id)
          }
          onServerChange={(patch) =>
            changeServerVoicePolicy(memberMenu.member.id, patch)
          }
        >
          {friends.some(
            (friend) =>
              friend.id === memberMenu.member.id &&
              friend.status === "accepted",
          ) && (
            <button
              type="button"
              role="menuitem"
              onClick={(event) => {
                openNotificationMute(
                  {
                    clientX: memberMenu.x,
                    clientY: memberMenu.y,
                    preventDefault: () => event.preventDefault(),
                  },
                  "direct",
                  memberMenu.member,
                );
                setMemberMenu(null);
              }}
            >
              Mute notifications…
            </button>
          )}
          {isSelectedServerOwner && memberMenu.member.role !== "owner" && (
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
          )}
        </VoiceParticipantMenu>
      )}
      {voiceMenu && (
        <VoiceParticipantMenu
          key={`${voiceMenu.channelId}:${voiceMenu.userId}:${voiceMenu.x}:${voiceMenu.y}`}
          x={voiceMenu.x}
          y={voiceMenu.y}
          canModerate={isSelectedServerOwner}
          serverPolicy={
            voicePolicies[`${session.user.id}:${selectedServerId}`]?.[
              voiceMenu.userId
            ] ?? members.find((member) => member.id === voiceMenu.userId)
          }
          onServerChange={(patch) =>
            changeServerVoicePolicy(voiceMenu.userId, patch)
          }
          audio={participantAudio.values[voiceMenu.userId]}
          onAudioChange={(patch) =>
            participantAudio.change(voiceMenu.userId, patch)
          }
          channels={channels.filter(
            (channel) =>
              channel.type !== "text" && channel.id !== voiceMenu.channelId,
          )}
          onClose={() => setVoiceMenu(null)}
          onKick={() =>
            void kickVoiceParticipant(voiceMenu.userId, voiceMenu.channelId)
          }
          onMove={(destinationId) =>
            void moveVoiceParticipant(
              voiceMenu.userId,
              voiceMenu.channelId,
              destinationId,
            )
          }
        />
      )}
      {messageContextDropdown}
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
      {managementOverlays}
      {compactLegalLinks}
      {errorToast}
      {noticeToast}
      {voiceTransferDialog}
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
  authorImage?: string | null;
  text: string;
  attachments?: MessageAttachment[];
  createdAt?: string | Date;
  editedAt?: string | Date | null;
  editedByAdmin?: boolean;
  mentions?: Mention[];
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
    authorImage: message.authorImage,
    editedByAdmin: message.editedByAdmin,
    mentions:
      message.deleted || message.deletedAt ? [] : (message.mentions ?? []),
    editedAt: message.editedAt
      ? new Date(message.editedAt).toISOString()
      : null,
    attachments:
      message.deleted || message.deletedAt ? [] : (message.attachments ?? []),
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
  return cameraCaptureConstraints(deviceId, readCameraResolution());
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
  return `${video.videoWidth}×${video.videoHeight}`;
}

async function preferVideoDetail(
  sender: RTCRtpSender,
  frameRate: VideoFrameRate = readCameraFrameRate(),
) {
  const parameters = sender.getParameters();
  parameters.degradationPreference =
    frameRate === 60 ? "maintain-framerate" : "maintain-resolution";
  parameters.encodings ??= [{}];
  for (const encoding of parameters.encodings) {
    Object.assign(
      encoding,
      videoPublishEncoding(
        (sender.track?.getSettings()?.height ?? 1080) /
          (encoding.scaleResolutionDownBy ?? 1),
        frameRate,
      ),
    );
  }
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
        const fps =
          stat.framesPerSecond !== undefined
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
