"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";

type ChatMessage = {
  id: string;
  author: string;
  text: string;
  time: string;
};

type Server = { id: string; name: string };
type Channel = { id: string; name: string; type: "text" | "voice" };
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

type Signal = {
  type: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
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
    "server" | "channel" | "account" | "manage" | null
  >(null);
  const [formName, setFormName] = useState("");
  const [channelType, setChannelType] = useState<"text" | "voice">("text");
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
  const [cameraOff, setCameraOff] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const connection = useRef<RTCPeerConnection | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const accountMenu = useRef<HTMLDivElement>(null);

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
    if (!selectedServerId) return;
    void fetch(`/api/servers/${selectedServerId}/channels`)
      .then((response) => response.json())
      .then((data: Channel[]) => {
        setChannels(data);
        setSelectedChannelId(data[0]?.id ?? "");
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
    const loadMessages = () =>
      void fetch(`/api/channels/${selectedChannelId}/messages`)
        .then((response) => response.json())
        .then((data) => {
          if (!Array.isArray(data)) return;
          setMessages(
            data.map((message) => ({
              id: message.id,
              author: message.author,
              text: message.text,
              time: new Date(message.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })),
          );
        });
    loadMessages();
    const interval = setInterval(loadMessages, 2000);
    return () => clearInterval(interval);
  }, [channels, selectedChannelId]);

  useEffect(
    () => () => {
      socket.current?.close();
      connection.current?.close();
      stream.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function send(signal: Signal | { type: "chat"; text: string }) {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(signal));
    }
  }

  async function ensureConnection() {
    if (connection.current) return connection.current;

    const peer = new RTCPeerConnection({ iceServers });
    stream.current
      ?.getTracks()
      .forEach((track) => peer.addTrack(track, stream.current!));

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        send({ type: "candidate", candidate: event.candidate.toJSON() });
      }
    };
    peer.ontrack = (event) => {
      if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
      setStatus("Connected to guest");
    };
    peer.onconnectionstatechange = () => {
      if (["disconnected", "failed"].includes(peer.connectionState)) {
        setStatus("Guest disconnected");
      }
    };
    connection.current = peer;
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
      return;
    }
    if (message.type === "room-full") {
      setJoining(false);
      setJoined(false);
      setStatus("Room is full");
      stopMedia();
      socket.current?.close();
      socket.current = null;
      return;
    }
    if (message.type === "peer-joined") {
      await createOffer();
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
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      connection.current?.close();
      connection.current = null;
      setStatus("Waiting for another person...");
      return;
    }
    // Text messages use PostgreSQL; this socket is only WebRTC signaling.
  }

  async function joinRoom() {
    if (!selectedChannelId) return;
    setJoining(true);
    setStatus("Requesting camera and microphone...");
    setMediaNotice("");

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      if (localVideo.current) localVideo.current.srcObject = stream.current;
    } catch (error) {
      const permissionDenied =
        error instanceof DOMException && error.name === "NotAllowedError";
      setMediaNotice(
        permissionDenied
          ? "Camera/microphone permission was denied. Joined receive-only."
          : "Camera or microphone is unavailable. Joined receive-only.",
      );
    }

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const host =
      location.hostname === "localhost"
        ? "localhost:3001"
        : `${location.hostname}:3001`;
    const ws = new WebSocket(`${protocol}://${host}`);
    socket.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "join", roomId: selectedChannelId }));
      setStatus("Joining signaling room...");
    };
    ws.onmessage = (event) => {
      void handleSignal(JSON.parse(event.data)).catch(() => {
        setStatus("WebRTC negotiation failed");
      });
    };
    ws.onerror = () => {
      setJoining(false);
      setStatus("Cannot reach signaling server");
    };
    ws.onclose = () => {
      setJoining(false);
      setJoined(false);
      setStatus("Signaling disconnected");
    };
  }

  function stopMedia() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
  }

  function leaveRoom() {
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
    setStatus("Not connected");
  }

  function toggleAudio() {
    const track = stream.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  }

  function toggleVideo() {
    const track = stream.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setCameraOff(!track.enabled);
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
      setMessages((current) => [
        ...current,
        { id: message.id, author: message.author, text, time: time() },
      ]);
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

  if (authStatus !== "authenticated") {
    return <main className="loginPage">Loading LC...</main>;
  }

  const selectedChannel = channels.find(
    (channel) => channel.id === selectedChannelId,
  );

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
                  leaveRoom();
                  setSelectedChannelId(channel.id);
                }}
              >
                # {channel.name}
              </button>
            ))}
          <p className="sectionLabel">VOICE CHANNELS</p>
          {channels
            .filter((channel) => channel.type === "voice")
            .map((channel) => (
              <button
                className={`channel ${channel.id === selectedChannelId ? "active" : ""}`}
                key={channel.id}
                onClick={() => {
                  leaveRoom();
                  setSelectedChannelId(channel.id);
                }}
              >
                {"\u{1F50A}"} {channel.name}
              </button>
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
        className={`room ${selectedChannel?.type !== "voice" ? "textOnly" : ""}`}
      >
        <header className="roomHeader">
          <strong>
            {selectedChannel
              ? `${selectedChannel.type === "text" ? "#" : "\u{1F50A}"} ${selectedChannel.name}`
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
                    void signOut({ callbackUrl: "/login" });
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </header>
        {selectedChannel?.type === "voice" && (
          <section className="callPanel">
            <div className="videoGrid">
              <div className="videoCard">
                <video ref={localVideo} autoPlay muted playsInline />
                <span>You</span>
              </div>
              <div className="videoCard remote">
                <video ref={remoteVideo} autoPlay playsInline />
                <span>Guest</span>
                <p>
                  {joined
                    ? "Share this page in another browser to join."
                    : "Join the voice channel to start."}
                </p>
              </div>
            </div>
            <div className="controls">
              {!joined ? (
                <button
                  className="primary"
                  onClick={joinRoom}
                  disabled={joining}
                >
                  {joining ? "Joining..." : "Join lounge"}
                </button>
              ) : (
                <>
                  <button onClick={toggleAudio}>
                    {muted ? "Unmute" : "Mute"}
                  </button>
                  <button onClick={toggleVideo}>
                    {cameraOff ? "Turn camera on" : "Turn camera off"}
                  </button>
                  <button className="danger" onClick={leaveRoom}>
                    Leave
                  </button>
                </>
              )}
            </div>
            {mediaNotice && <p className="mediaNotice">{mediaNotice}</p>}
          </section>
        )}
        {selectedChannel?.type !== "voice" && (
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
        {members.map((member) => (
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
                    : "Manage demo accounts"}
            </h2>
            {form !== "manage" && (
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
                    setChannelType(event.target.value as "text" | "voice")
                  }
                >
                  <option value="text">Text</option>
                  <option value="voice">Voice and video</option>
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
            <div className="modalActions">
              <button type="button" onClick={closeForm}>
                {form === "manage" ? "Close" : "Cancel"}
              </button>
              {form !== "manage" && (
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
    </main>
  );
}

function time() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
