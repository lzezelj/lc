"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: number;
  author: "You" | "Guest";
  text: string;
  time: string;
};

type Signal = {
  type: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const ROOM_ID = "cv-demo-room";
const iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export default function Home() {
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
    if (message.type === "chat" && "text" in message) {
      setMessages((current) => [
        ...current,
        { id: Date.now(), author: "Guest", text: message.text, time: time() },
      ]);
    }
  }

  async function joinRoom() {
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
      ws.send(JSON.stringify({ type: "join", roomId: ROOM_ID }));
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

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !joined) return;
    setMessages((current) => [
      ...current,
      { id: Date.now(), author: "You", text, time: time() },
    ]);
    send({ type: "chat", text });
    setDraft("");
  }

  return (
    <main className="lcApp">
      <header className="topbar">
        <div className="logo">LC</div>
        <span>Single-room WebRTC prototype</span>
        <span className="connection">● {status}</span>
      </header>
      <section className="stage">
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
                : "Join the room to start."}
            </p>
          </div>
        </div>
        <div className="controls">
          {!joined ? (
            <button className="primary" onClick={joinRoom} disabled={joining}>
              {joining ? "Joining..." : "Join room"}
            </button>
          ) : (
            <>
              <button onClick={toggleAudio}>{muted ? "Unmute" : "Mute"}</button>
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
      <section className="chat">
        <header>
          <strong>Room chat</strong>
          <small>Messages are relayed live, not stored yet.</small>
        </header>
        <div className="chatLog">
          {messages.length === 0 && (
            <p className="empty">Say hello once two people have joined.</p>
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
            disabled={!joined}
            placeholder={joined ? "Write a message" : "Join the room to chat"}
          />
          <button disabled={!joined}>Send</button>
        </form>
      </section>
    </main>
  );
}

function time() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
