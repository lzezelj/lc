import React from "react";
import { createRoot } from "react-dom/client";
import { CallMediaProvider, useCallAudio } from "./call-media.js";
import { WorkspaceShell } from "./workspace-shell.js";
import { GroupCall } from "./group-call-probe.js";

window.runCallNavigationTest = async () => {
  const errors = [];
  const recordError = (event) => errors.push(event.message);
  window.addEventListener("error", recordError);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let audioRef;
  function Workspace({ view }) {
    audioRef = useCallAudio();
    return React.createElement(
      WorkspaceShell,
      {
        className: `workspace ${view}`,
        call: React.createElement(GroupCall, {
          key: "persistent-group",
          channelId: "group",
          currentUserName: "Local",
          initialMuted: true,
          microphones: [],
          cameras: [],
          microphoneId: "",
          cameraId: "",
          autoJoin: true,
          viewOpen: view === "server",
          onConnectionChange: (value) => {
            window.groupNavigation.connected = value;
          },
          onMediaStateChange() {},
          onMicrophoneChange() {},
          onCameraChange() {},
          onOpenView() {},
          onPingChange() {},
          onDiagnosticsChange() {},
          onLeave() {
            throw new Error("Navigation ended the group call");
          },
          onError(message) {
            throw new Error(message);
          },
        }),
      },
      view === "friends"
        ? React.createElement("section", null, "Friends call")
        : React.createElement("aside", null, "Server channels"),
    );
  }
  async function render(view) {
    root.render(
      React.createElement(
        CallMediaProvider,
        null,
        React.createElement(Workspace, { view }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const context = new AudioContext();
  await context.resume();
  const tone = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  window.groupNavigation = {
    context,
    stream: destination.stream,
    connects: 0,
    disconnects: 0,
    attaches: 0,
    detaches: 0,
    connected: false,
  };
  tone.connect(destination);
  tone.start();
  let result;
  try {
    await render("friends");
    for (let i = 0; i < 20 && !window.groupNavigation.connected; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (!window.groupNavigation.connected)
      throw new Error(`Group call did not join: ${errors.join("; ")}`);
    const groupAudio = container.querySelector(".persistentCallLayer audio");
    if (!groupAudio) throw new Error("Group audio did not attach");
    await groupAudio.play();
    const originalRef = audioRef;
    const originalAudio = audioRef.current;
    originalAudio.srcObject = destination.stream;
    await originalAudio.play();
    let elementStable = true;
    let streamStable = true;
    let playbackUninterrupted = true;
    for (let i = 0; i < 12; i++) {
      await render(i % 2 === 0 ? "server" : "friends");
      elementStable &&=
        audioRef === originalRef && audioRef.current === originalAudio;
      streamStable &&= originalAudio.srcObject === destination.stream;
      playbackUninterrupted &&=
        !originalAudio.paused && originalAudio.isConnected;
      if (
        container.querySelector(".persistentCallLayer audio") !== groupAudio ||
        groupAudio.paused ||
        groupAudio.srcObject !== destination.stream
      )
        throw new Error("Navigation replaced or interrupted group audio");
      if (
        window.groupNavigation.connects !== 1 ||
        window.groupNavigation.disconnects !== 0 ||
        window.groupNavigation.attaches !== 1 ||
        window.groupNavigation.detaches !== 0
      )
        throw new Error(
          `Navigation recreated the LiveKit room: ${JSON.stringify({ connects: window.groupNavigation.connects, disconnects: window.groupNavigation.disconnects, attaches: window.groupNavigation.attaches, detaches: window.groupNavigation.detaches })}`,
        );
    }
    result = {
      elementStable,
      streamStable,
      playbackUninterrupted,
      audioElements: container.querySelectorAll("[data-lc-call-audio]").length,
      trackState: destination.stream.getAudioTracks()[0].readyState,
      groupRoomPreserved: true,
      groupAudioPreserved: true,
    };
  } finally {
    window.removeEventListener("error", recordError);
    root.unmount();
    container.remove();
    tone.stop();
    destination.stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }
  return result;
};
