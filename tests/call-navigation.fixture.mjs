import React from "react";
import { createRoot } from "react-dom/client";
import { CallMediaProvider, useCallAudio } from "./call-media.js";

window.runCallNavigationTest = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let audioRef;
  function Workspace({ view }) {
    audioRef = useCallAudio();
    return React.createElement(
      "main",
      { className: view },
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
  tone.connect(destination);
  tone.start();
  let result;
  try {
    await render("friends");
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
    }
    result = {
      elementStable,
      streamStable,
      playbackUninterrupted,
      audioElements: container.querySelectorAll("[data-lc-call-audio]").length,
      trackState: destination.stream.getAudioTracks()[0].readyState,
    };
  } finally {
    root.unmount();
    container.remove();
    tone.stop();
    destination.stream.getTracks().forEach((track) => track.stop());
    await context.close();
  }
  return result;
};
