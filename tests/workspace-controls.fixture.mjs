import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal, SettingsIcon } from "./settings-modal.js";
import { SidebarResizer } from "./sidebar-resizer.js";
import { DiagnosticsIndicator } from "./diagnostics.js";
import { DeviceMenu } from "./device-menu.js";
import { AudioDeviceOptions } from "./audio-device-options.js";
import { UserStatusMenu } from "./user-status-menu.js";
import { CallMediaProvider, useCallAudio } from "./call-media.js";

const h = React.createElement;
const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
const check = (value, message) => {
  if (!value) throw new Error(message);
};
let callAudio;
function Workspace() {
  const audio = useCallAudio();
  useEffect(() => {
    callAudio = audio;
  }, [audio]);
  const [settings, setSettings] = useState(null);
  const [width, setWidth] = useState(null);
  const [joined, setJoined] = useState(true);
  const [outputId, setOutputId] = useState("");
  const [status, setStatus] = useState("online");
  useEffect(() => {
    window.workspaceOutputChoice = outputId;
  }, [outputId]);
  const audioOptions = (mode) =>
    h(AudioDeviceOptions, {
      mode,
      outputs: [{ deviceId: "test-output", label: "Test headphones" }],
      outputId,
      outputSupported: true,
      microphoneVolume: 100,
      outputVolume: 100,
      onOutputChange: (id) => {
        setOutputId(id);
      },
      onMicrophoneVolumeChange() {},
      onOutputVolumeChange() {},
    });
  useEffect(() => {
    window.setWorkspaceCallJoined = setJoined;
  }, []);
  return h(
    "main",
    {
      className: `workspace ${joined ? "voiceActive" : ""}`,
      style: { "--preferred-sidebar-width": width ? `${width}px` : undefined },
    },
    h("aside", { className: "workspaceRail" }, "LC"),
    h(
      "aside",
      { className: "channelSidebar" },
      h(
        "header",
        { className: "workspaceName" },
        "Test server",
        h(
          "button",
          {
            id: "server-settings",
            onClick: () => setSettings("Server settings"),
          },
          h(SettingsIcon),
        ),
      ),
      h("nav", null, "Channels"),
      h(
        "footer",
        { className: "profileBar" },
        h(
          "div",
          { className: "profileMenu accountMenu" },
          h(UserStatusMenu, {
            name: "Test user",
            status,
            speaking: false,
            onChange: setStatus,
          }),
          !joined &&
            h(
              "div",
              { className: "controls profileMicrophone" },
              h(DeviceMenu, {
                kind: "microphone",
                extraOptions: audioOptions("input"),
                disabled: false,
                devices: [],
                selectedId: "",
                onAction() {},
                onSelect() {},
              }),
            ),
          h(
            "div",
            { className: "controls profileDeafen" },
            h(DeviceMenu, {
              kind: "headphones",
              disabled: false,
              devices: [],
              selectedId: outputId,
              onAction() {},
              onSelect() {},
              extraOptions: audioOptions("output"),
            }),
          ),
          h(
            "button",
            {
              id: "user-settings",
              className: "profileSettings",
              onClick: () => setSettings("User settings"),
            },
            h(SettingsIcon),
          ),
        ),
        joined &&
          h(
            "div",
            { className: "profileConnectionDetails" },
            h("span", null, "Connected to Test"),
            h(DiagnosticsIndicator, { diagnostics: null }),
          ),
      ),
      h(SidebarResizer, { onResize: setWidth, onReset: () => setWidth(null) }),
    ),
    h(
      "section",
      { className: "room" },
      h("header", { className: "roomHeader" }, "general"),
      joined &&
        h(
          "div",
          { className: "controls voiceDock" },
          ...["microphone", "camera"].map((kind) =>
            h(DeviceMenu, {
              key: kind,
              kind,
              extraOptions:
                kind === "microphone" ? audioOptions("input") : undefined,
              disabled: false,
              devices: [],
              selectedId: "",
              onAction() {},
              onSelect() {},
            }),
          ),
          h("button", null, "Share screen"),
          h(
            "button",
            { disabled: true, className: "soundboardPlaceholder" },
            "Soundboard",
          ),
        ),
    ),
    h("aside", { className: "memberSidebar" }, "Users"),
    settings &&
      h(
        SettingsModal,
        { title: settings, onClose: () => setSettings(null) },
        h("button", null, "Voice and video"),
        h("button", null, "Other settings"),
      ),
  );
}

window.setupWorkspaceControlsTest = async () => {
  // The about:blank browser harness has an opaque origin, so provide session
  // storage for actual device-menu preferences without accessing a real profile.
  const preferences = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => preferences.get(key) ?? null,
      setItem: (key, value) => preferences.set(key, String(value)),
      removeItem: (key) => preferences.delete(key),
    },
  });
  document.body.style.margin = "0";
  const viewport = document.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  document.head.append(viewport);
  const container = document.createElement("div");
  document.body.append(container);
  window.workspaceRoot = createRoot(container);
  window.workspaceRoot.render(h(CallMediaProvider, null, h(Workspace)));
  await wait();
  const context = new AudioContext();
  await context.resume();
  const tone = context.createOscillator();
  const output = context.createMediaStreamDestination();
  tone.connect(output);
  tone.start();
  callAudio.current.srcObject = output.stream;
  await callAudio.current.play();
  window.workspaceAudio = { context, tone, output, element: callAudio.current };
  const rect = document
    .querySelector(".sidebarResizer")
    .getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + 100,
    width: document.querySelector(".channelSidebar").getBoundingClientRect()
      .width,
  };
};

window.verifyMicrophonePosition = async () => {
  const arrowPosition = (selector) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(selector));
    return range.getBoundingClientRect();
  };
  window.setWorkspaceCallJoined(false);
  await wait();
  const idle = document
    .querySelector(".profileMicrophone .mediaToggle svg")
    .getBoundingClientRect();
  const idleArrow = arrowPosition(".profileMicrophone .deviceMenuTrigger");
  window.setWorkspaceCallJoined(true);
  await wait();
  const joined = document
    .querySelector('.voiceDock [aria-label="Mute microphone"] svg')
    .getBoundingClientRect();
  const joinedArrow = arrowPosition(
    ".voiceDock > .deviceControl:first-of-type .deviceMenuTrigger",
  );
  check(
    Math.abs(idle.x - joined.x) < 0.1 && Math.abs(idle.y - joined.y) < 0.1,
    `Microphone moved on join: idle (${idle.x}, ${idle.y}), joined (${joined.x}, ${joined.y})`,
  );
  check(
    Math.abs(idleArrow.x - joinedArrow.x) < 0.1 &&
      Math.abs(idleArrow.y - joinedArrow.y) < 0.1,
    `Device arrow moved on join: idle (${idleArrow.x}, ${idleArrow.y}), joined (${joinedArrow.x}, ${joinedArrow.y})`,
  );
  const headphones = document
    .querySelector(".profileDeafen .mediaToggle")
    .getBoundingClientRect();
  const headphonesIcon = document
    .querySelector(".profileDeafen .mediaToggle svg")
    .getBoundingClientRect();
  check(
    Math.abs(
      headphonesIcon.x +
        headphonesIcon.width / 2 -
        headphones.x -
        headphones.width / 2,
    ) < 0.1 &&
      Math.abs(
        headphonesIcon.y +
          headphonesIcon.height / 2 -
          headphones.y -
          headphones.height / 2,
      ) < 0.1,
    "Headphones icon is not centered in its button",
  );
  const profile = document.querySelector(".profileBar").getBoundingClientRect();
  const connection = document
    .querySelector(".profileConnectionDetails")
    .getBoundingClientRect();
  const actions = document.querySelector(".voiceDock").getBoundingClientRect();
  check(
    Math.abs(actions.bottom - connection.top) < 1 &&
      Math.abs(connection.bottom - profile.top) < 1,
    "Footer rows do not form a connected panel",
  );
  check(
    Math.abs(actions.left - profile.left) < 1 &&
      Math.abs(actions.right - profile.right) < 1,
    "Footer rows do not share aligned edges",
  );
  const identity = document
    .querySelector(".profileIdentity strong")
    .getBoundingClientRect();
  check(
    identity.right <= idle.x || identity.bottom <= joined.y,
    "Profile identity overlaps the audio controls",
  );
  return { x: joined.x, y: joined.y };
};

window.verifyWorkspaceControlsTest = async () => {
  await wait();
  const sidebar = document.querySelector(".channelSidebar");
  const handle = document.querySelector(".sidebarResizer");
  const draggedWidth = sidebar.getBoundingClientRect().width;
  check(
    draggedWidth > 360,
    "Pointer dragging did not resize the channel sidebar",
  );
  handle.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
  );
  await wait();
  check(
    sidebar.getBoundingClientRect().width === draggedWidth - 10,
    "Keyboard resize did not change width",
  );
  handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await wait();
  check(
    sidebar.getBoundingClientRect().width === 340,
    "Double click did not restore default width",
  );
  await window.verifyMicrophonePosition();
  const statusTrigger = document.querySelector(".profileStatusTrigger");
  statusTrigger.click();
  await wait();
  const statusMenu = document.querySelector(".userStatusDropdown");
  check(
    statusMenu.contains(document.activeElement),
    "Status menu did not receive keyboard focus",
  );
  statusMenu.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  check(
    document.activeElement.textContent.includes("Away"),
    "Status keyboard navigation failed",
  );
  document.activeElement.click();
  await wait();
  check(
    statusTrigger.textContent.includes("Away"),
    "Profile status did not update",
  );
  check(
    !document.querySelector(".userStatusDropdown") &&
      document.activeElement === statusTrigger,
    "Status menu did not close and restore focus",
  );
  document.querySelector('.voiceDock [aria-label="Choose microphone"]').click();
  await wait();
  const deviceMenu = document.querySelector(".deviceDropdown");
  check(
    deviceMenu.querySelector(".deviceChoices").open,
    "Input devices should start expanded",
  );
  check(
    deviceMenu.querySelector(".deviceChoices summary").textContent ===
      "Input devices",
    "Input devices are not grouped in their own menu",
  );
  check(
    deviceMenu.querySelectorAll('input[type="range"]').length === 1 &&
      deviceMenu.querySelector("select"),
    "Microphone menu must contain its input selector and input volume",
  );
  const inputComputed = getComputedStyle(deviceMenu.querySelector("select"));
  const inputStyle = {
    borderRadius: inputComputed.borderRadius,
    backgroundColor: inputComputed.backgroundColor,
  };
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true }),
  );
  document.querySelector('[aria-label="Output options"]').click();
  await wait();
  const outputMenu = document.querySelector(".profileDeafen .deviceDropdown");
  check(
    outputMenu.querySelector(".audioDeviceOptions details").open,
    "Output devices should start expanded",
  );
  const output = outputMenu.querySelector(".audioDeviceOptions select");
  const outputStyle = getComputedStyle(output);
  check(
    inputStyle.borderRadius === outputStyle.borderRadius &&
      inputStyle.backgroundColor === outputStyle.backgroundColor,
    "Input/output device selectors must share the same style",
  );
  output.value = "test-output";
  output.dispatchEvent(new Event("change", { bubbles: true }));
  await wait();
  check(
    window.workspaceOutputChoice === "test-output",
    "Output device menu did not update selection",
  );
  check(
    outputMenu.querySelectorAll('input[type="range"]').length === 1,
    "Deafen menu must contain output volume only",
  );
  const microphone = document
    .querySelector('.voiceDock [aria-label="Mute microphone"]')
    .getBoundingClientRect();
  const headphones = document
    .querySelector(".profileDeafen")
    .getBoundingClientRect();
  check(
    microphone.right < headphones.left,
    "Microphone overlaps the deafen control",
  );
  document.body.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true }),
  );
  await wait();
  check(
    document.querySelector("#server-settings svg").outerHTML ===
      document.querySelector("#user-settings svg").outerHTML,
    "The cogs differ",
  );
  for (const id of ["user-settings", "server-settings"]) {
    const trigger = document.getElementById(id);
    trigger.focus();
    trigger.click();
    await wait();
    const dialog = document.querySelector("dialog");
    check(dialog?.matches(":modal"), "Settings did not open in the top layer");
    check(
      dialog.contains(document.activeElement),
      "Focus did not enter settings",
    );
    document.querySelector(".voiceDock button").focus();
    check(
      dialog.contains(document.activeElement),
      "Focus escaped to call controls behind settings",
    );
    dialog.querySelector(".settingsClose").click();
    await wait();
    check(!document.querySelector("dialog"), "Settings did not close");
    check(
      document.activeElement === trigger,
      "Focus did not return to the cog",
    );
  }
  document.getElementById("user-settings").click();
  await wait();
  document
    .querySelector("dialog")
    .dispatchEvent(new Event("cancel", { cancelable: true }));
  await wait();
  check(
    !document.querySelector("dialog"),
    "Escape/cancel did not close settings",
  );
  const info = document.querySelector(".diagnosticsIndicator");
  info.focus();
  info.click();
  await wait();
  const popup = document
    .querySelector(".diagnosticsTooltip")
    .getBoundingClientRect();
  const anchor = info.getBoundingClientRect();
  check(
    Math.abs(popup.bottom - (anchor.top - 10)) < 2,
    "Diagnostics is not anchored to the icon",
  );
  check(
    popup.left >= 15 && popup.right <= innerWidth - 15,
    "Diagnostics exceeds the viewport",
  );
  info.blur();
  await wait();
  const media = window.workspaceAudio;
  check(
    callAudio.current === media.element &&
      callAudio.current.srcObject === media.output.stream &&
      !callAudio.current.paused,
    "Settings interrupted the call audio",
  );
  media.tone.stop();
  media.output.stream.getTracks().forEach((track) => track.stop());
  await media.context.close();
  return {
    draggedWidth,
    keyboardResize: true,
    reset: true,
    identicalCogs: true,
    modalFocus: true,
    diagnosticsAnchored: true,
    callAudioPreserved: true,
  };
};
