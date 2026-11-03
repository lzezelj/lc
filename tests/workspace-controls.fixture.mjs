import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SettingsModal,
  SettingsIcon,
  SettingsNameForm,
} from "./settings-modal.js";
import { UserProfile } from "./user-profile.js";
import { ChannelManager } from "./channel-manager.js";
import { MessageDeleteAction } from "./message-delete-action.js";
import { ChatHistory } from "./chat-history.js";
import { useMessageCooldown } from "./use-message-cooldown.js";
import { MessageHeader } from "./message-header.js";
import { SidebarResizer } from "./sidebar-resizer.js";
import { DiagnosticsIndicator } from "./diagnostics.js";
import { DeviceMenu } from "./device-menu.js";
import { DeviceSelection } from "./device-selection.js";
import { AudioDeviceOptions } from "./audio-device-options.js";
import { UserStatusMenu } from "./user-status-menu.js";
import { CallMediaProvider, useCallAudio } from "./call-media.js";

const h = React.createElement;
const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
const check = (value, message) => {
  if (!value) throw new Error(message);
};
async function verifyMessageCooldown() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let sends = 0;
  function Composer() {
    const cooldown = useMessageCooldown();
    return h(
      "form",
      {
        onSubmit(event) {
          event.preventDefault();
          if (cooldown.blocked()) return;
          sends++;
          cooldown.handleResponse(
            new Response(null, {
              status: 429,
              headers: { "Retry-After": "2" },
            }),
          );
        },
      },
      h("input", { defaultValue: "Keep this draft" }),
      ...["channel", "dm"].map((key) =>
        h(
          "button",
          { key, disabled: cooldown.seconds > 0 },
          cooldown.seconds ? `Wait ${cooldown.seconds}s` : "Send",
        ),
      ),
    );
  }
  root.render(h(Composer));
  await wait();
  container.querySelector("button").click();
  await wait();
  check(
    [...container.querySelectorAll("button")].every(
      (button) => button.disabled && button.textContent === "Wait 2s",
    ),
    "Rate limiting must disable both send buttons with the server countdown",
  );
  container
    .querySelector("form")
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  check(sends === 1, "Enter must not bypass the message cooldown");
  check(
    container.querySelector("input").value === "Keep this draft",
    "Rate limiting must preserve the draft",
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  check(
    container.querySelector("button").textContent === "Wait 1s",
    "Countdown must decrease",
  );
  await new Promise((resolve) => setTimeout(resolve, 1100));
  check(
    [...container.querySelectorAll("button")].every(
      (button) => !button.disabled && button.textContent === "Send",
    ),
    "Send must re-enable when the cooldown expires",
  );
  check(sends === 1, "Cooldown expiry must not resend the draft");
  root.unmount();
  container.remove();
}
let callAudio;
function Workspace() {
  const audio = useCallAudio();
  useEffect(() => {
    callAudio = audio;
  }, [audio]);
  const [settings, setSettings] = useState(null);
  const [section, setSection] = useState("account");
  const [messageServers, setMessageServers] = useState([
    "First server",
    "Other server",
  ]);
  const [managedChannels, setManagedChannels] = useState([
    { id: "general", name: "General", type: "text" },
  ]);
  const [profile, setProfile] = useState(false);
  const [profileRelation, setProfileRelation] = useState("accepted");
  useEffect(() => {
    window.setProfileRelation = setProfileRelation;
  }, []);
  const [savedName, setSavedName] = useState("");
  const [messageClicked, setMessageClicked] = useState(false);
  useEffect(() => {
    window.savedSettingsName = savedName;
    window.profileMessageClicked = messageClicked;
  }, [savedName, messageClicked]);
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
    window.setWorkspaceProfileStatus = setStatus;
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
      { className: "channelSidebar friendsSidebar" },
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
      h("nav", null, h("div", { style: { height: 2400 } }, "Friends")),
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
    h(
      "aside",
      { className: "memberSidebar friendsInfoSidebar" },
      h("header", { className: "memberSidebarHeader" }, "Profile"),
      h(
        "div",
        { className: "memberScroll" },
        h(
          "button",
          {
            type: "button",
            className: "friendProfileCard",
            onClick: () => setProfile(true),
          },
          h("span", { className: "avatar" }, "L"),
          h(
            "strong",
            null,
            "A very long friend display name to check sidebar overflow",
          ),
          h("small", null, "long.friend.handle (0001)"),
        ),
      ),
      h(
        "footer",
        { className: "appLegalLinks" },
        h("button", { type: "button" }, "Impressum"),
        h("button", { type: "button" }, "Privacy"),
      ),
    ),
    settings &&
      h(
        SettingsModal,
        {
          title: settings,
          onClose: () => setSettings(null),
          navigation: [
            "account",
            "media",
            "channels",
            "messages",
            "delete",
          ].map((id) =>
            h(
              "button",
              {
                key: id,
                type: "button",
                "data-section": id,
                className: id === "delete" ? "danger" : undefined,
                "aria-current": section === id ? "page" : undefined,
                onClick: () => setSection(id),
              },
              id,
            ),
          ),
        },
        h("h3", null, section === "account" ? "My account" : "Voice & video"),
        section === "messages"
          ? h(
              "div",
              null,
              messageServers.map((name) =>
                h(
                  "section",
                  { key: name, "data-server": name },
                  h("h4", null, name),
                  h(MessageDeleteAction, {
                    label: "Delete messages in this server",
                    confirmation: `Delete messages in ${name}?`,
                    onDelete: async () => {
                      if (window.rejectMessageDelete)
                        throw new Error("Message deletion failed");
                      setMessageServers((current) =>
                        current.filter((item) => item !== name),
                      );
                    },
                  }),
                ),
              ),
            )
          : section === "channels"
            ? h(ChannelManager, {
                channels: managedChannels,
                onRename: async (channel, name) =>
                  setManagedChannels((current) =>
                    current.map((item) =>
                      item.id === channel.id ? { ...item, name } : item,
                    ),
                  ),
                onDelete: async (channel) => {
                  if (window.rejectChannelDelete)
                    throw new Error("Deletion failed");
                  setManagedChannels((current) =>
                    current.filter((item) => item.id !== channel.id),
                  );
                },
              })
            : section === "account"
              ? h(SettingsNameForm, {
                  name: "Lovro",
                  label: "Display name",
                  onSave: async (name) => {
                    setSavedName(name);
                  },
                })
              : h(
                  "div",
                  { className: "mediaSettings" },
                  h(DeviceSelection, {
                    label: "Microphone",
                    devices: [],
                    selectedId: "",
                    onSelect() {},
                  }),
                  audioOptions("both"),
                  h(DeviceSelection, {
                    label: "Camera",
                    devices: [],
                    selectedId: "",
                    onSelect() {},
                  }),
                ),
      ),
    h(
      "button",
      {
        id: "open-profile",
        type: "button",
        style: { position: "fixed", right: 16, bottom: 16 },
        onClick: () => setProfile(true),
      },
      "View profile",
    ),
    profile &&
      h(UserProfile, {
        user: {
          id: "lovro",
          name: "Lovro",
          handle: "lovro.0001",
          role: "member",
        },
        status,
        mutualServers: ["Test server"],
        onClose: () => setProfile(false),
        requestPending: profileRelation === "outgoing",
        onAddFriend:
          profileRelation === "none"
            ? async () => {
                await new Promise((resolve) => setTimeout(resolve, 120));
                if (window.rejectProfileRequest)
                  throw new Error("Request failed");
                setProfileRelation("outgoing");
              }
            : undefined,
        onAcceptFriend:
          profileRelation === "incoming"
            ? async () => {
                setProfileRelation("accepted");
              }
            : undefined,
        onMessage:
          profileRelation === "accepted"
            ? () => {
                setMessageClicked(true);
                setProfile(false);
              }
            : undefined,
      }),
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
  const idleLegal = document
    .querySelector(".appLegalLinks")
    .getBoundingClientRect();
  const idle = document
    .querySelector(".profileMicrophone .mediaToggle svg")
    .getBoundingClientRect();
  const idleArrow = arrowPosition(".profileMicrophone .deviceMenuTrigger");
  window.setWorkspaceCallJoined(true);
  await wait();
  const joinedLegal = document
    .querySelector(".appLegalLinks")
    .getBoundingClientRect();
  check(
    ["x", "y", "width", "height"].every(
      (key) => Math.abs(idleLegal[key] - joinedLegal[key]) < 0.1,
    ),
    "Joining voice moved or resized the legal-links footer",
  );
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
  const friendsNav = sidebar.querySelector("nav");
  check(
    getComputedStyle(friendsNav).scrollbarWidth !== "none",
    "Friends conversation scrollbar should retain its normal styling",
  );
  friendsNav.scrollTop = 100;
  check(
    friendsNav.scrollTop > 0 &&
      getComputedStyle(friendsNav).overflowY === "auto",
    "Friends conversation sidebar cannot scroll",
  );
  friendsNav.scrollTop = 0;
  const profilePanel = document.querySelector(
    ".friendsInfoSidebar .memberScroll",
  );
  const profileCard = profilePanel.querySelector(".friendProfileCard");
  check(
    getComputedStyle(profilePanel).overflowX === "hidden" &&
      getComputedStyle(profilePanel).overflowY === "auto",
    "Right-hand profile panel must scroll vertically only",
  );
  check(
    getComputedStyle(friendsNav).overflowX === "hidden",
    "Sidebar navigation must not show a horizontal scrollbar",
  );
  check(
    profilePanel.clientWidth > 0 &&
      profilePanel.scrollWidth <= profilePanel.clientWidth,
    "Right-hand Friends profile panel overflows horizontally",
  );
  check(
    profileCard.getBoundingClientRect().right <=
      profilePanel.getBoundingClientRect().right,
    "Friend profile card exceeds its panel width",
  );
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
    sidebar.getBoundingClientRect().width === 380,
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
    deviceMenu
      .querySelector(".deviceSelection label")
      .textContent.includes("Microphone") &&
      !deviceMenu.querySelector("summary"),
    "Microphone selection should use only a label and selector",
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
    outputMenu
      .querySelector(".deviceSelection label")
      .textContent.includes("Headphones / speakers") &&
      !outputMenu.querySelector("summary"),
    "Output selection should use only a label and selector",
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
  check(
    headphones.width ===
      document
        .querySelector(".voiceDock > .deviceControl:first-of-type")
        .getBoundingClientRect().width,
    "Deafen and microphone controls must have equal width",
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
    const audio = window.workspaceAudio.element;
    const stream = audio.srcObject;
    dialog.querySelector('[data-section="media"]').click();
    await wait();
    check(
      document.querySelector("dialog") === dialog &&
        document.querySelectorAll("dialog").length === 1,
      "Section navigation replaced the settings dialog",
    );
    check(
      dialog.querySelector(".settingsContent h3").textContent ===
        "Voice & video",
      "Section content did not change",
    );
    const selectors = [...dialog.querySelectorAll(".deviceSelection select")];
    check(
      selectors.length === 3,
      "Media settings must render microphone, output and camera selectors",
    );
    const appearance = (element) => {
      const style = getComputedStyle(element);
      return [
        style.fontSize,
        style.color,
        style.backgroundColor,
        style.padding,
        style.border,
        style.borderRadius,
        element.getBoundingClientRect().height,
      ].join("|");
    };
    check(
      selectors.every(
        (select) => appearance(select) === appearance(selectors[0]),
      ),
      "Device selectors have inconsistent styling",
    );
    const labels = selectors.map((select) => select.closest("label"));
    check(
      labels.every(
        (label) =>
          getComputedStyle(label).fontSize ===
            getComputedStyle(labels[0]).fontSize &&
          getComputedStyle(label).color === getComputedStyle(labels[0]).color,
      ),
      "Device labels have inconsistent styling",
    );
    dialog.querySelector('[data-section="account"]').click();
    await wait();
    const input = dialog.querySelector("input");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, "Updated name");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    dialog.querySelector('button[type="submit"]').click();
    await wait();
    check(
      window.savedSettingsName === "Updated name",
      "Inline settings save did not receive the edited name",
    );
    check(
      audio === window.workspaceAudio.element &&
        audio.srcObject === stream &&
        !audio.paused,
      "Section changes interrupted call audio",
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
  document.getElementById("server-settings").click();
  await wait();
  const management = document.querySelector("dialog");
  const deleteServer = management.querySelector('[data-section="delete"]');
  check(
    getComputedStyle(deleteServer).color === "rgb(255, 137, 156)",
    "Delete server navigation is not red",
  );
  management.querySelector('[data-section="channels"]').click();
  await wait();
  management.querySelector(".managedChannelActions button").click();
  await wait();
  const channelName = management.querySelector(".settingsNameForm input");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    channelName,
    "Renamed channel",
  );
  channelName.dispatchEvent(new Event("input", { bubbles: true }));
  await wait();
  management.querySelector('.settingsNameForm button[type="submit"]').click();
  await wait();
  check(
    management.querySelector(".managedChannelHeading strong").textContent ===
      "Renamed channel",
    "Channel rename did not update the list",
  );
  management.querySelector(".managedChannelActions button.danger").click();
  await wait();
  check(
    management.querySelector(".settingsDangerZone") &&
      management.querySelector(".managedChannel"),
    "Channel deletion did not ask for confirmation",
  );
  management.querySelector(".settingsDangerZone button").click();
  await wait();
  check(
    !management.querySelector(".settingsDangerZone") &&
      management.querySelector(".managedChannel"),
    "Canceling deleted the channel",
  );
  management.querySelector(".managedChannelActions button.danger").click();
  await wait();
  window.rejectChannelDelete = true;
  management.querySelector(".settingsDangerZone button.danger").click();
  await wait();
  check(
    management.querySelector('[role="alert"]')?.textContent ===
      "Deletion failed",
    "Channel delete error was not displayed",
  );
  window.rejectChannelDelete = false;
  management.querySelector(".settingsDangerZone button.danger").click();
  await wait();
  check(
    !management.querySelector(".managedChannel"),
    "Confirmed channel deletion did not remove the row",
  );
  management.querySelector('[data-section="messages"]').click();
  await wait();
  const firstServer = management.querySelector('[data-server="First server"]');
  firstServer.querySelector(".messageBulkDelete > button").click();
  await wait();
  check(
    firstServer.querySelector(".settingsDangerZone"),
    "Server message deletion did not ask for confirmation",
  );
  firstServer.querySelector(".settingsDangerZone button").click();
  await wait();
  check(
    !firstServer.querySelector(".settingsDangerZone"),
    "Canceling message deletion did not dismiss confirmation",
  );
  firstServer.querySelector(".messageBulkDelete > button").click();
  await wait();
  window.rejectMessageDelete = true;
  firstServer.querySelector(".settingsDangerZone button.danger").click();
  await wait();
  check(
    firstServer.querySelector('[role="alert"]')?.textContent ===
      "Message deletion failed",
    "Message delete error was not shown inline",
  );
  window.rejectMessageDelete = false;
  firstServer.querySelector(".settingsDangerZone button.danger").click();
  await wait();
  check(
    !management.querySelector('[data-server="First server"]') &&
      management.querySelector('[data-server="Other server"]'),
    "Deleting server messages removed the wrong groups",
  );
  management.querySelector(".settingsClose").click();
  await wait();
  await window.verifySettingsAndProfileLayout();
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
  await window.verifyChatHistory();
  const panelProbe = document.createElement("div");
  panelProbe.className = "workspace";
  panelProbe.style.cssText =
    "position:fixed;inset:0;z-index:1000;pointer-events:none";
  panelProbe.innerHTML =
    '<nav class="panelControls"><button type="button">Toggle panel</button></nav>';
  document.body.append(panelProbe);
  const panelButton = panelProbe.querySelector("button");
  check(
    getComputedStyle(panelButton).opacity === "1",
    "Panel controls must remain visible",
  );
  panelButton.focus();
  check(
    getComputedStyle(panelButton).opacity === "1",
    "Keyboard focus must reveal panel controls",
  );
  panelProbe.remove();
  await verifyMessageCooldown();
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

function HistoryFixture() {
  const [messages, setMessages] = useState(
    Array.from({ length: 50 }, (_, index) => ({
      id: String(index + 51),
      authorId: "friend",
    })),
  );
  const [thread, setThread] = useState("first");
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    window.historyTestActions = {
      requests,
      append: (authorId = "friend") =>
        setMessages((current) => [
          ...current,
          { id: String(Number(current.at(-1).id) + 1), authorId },
        ]),
      switchThread: () => {
        setThread("second");
        setReady(false);
        setTimeout(() => {
          setMessages(
            Array.from({ length: 50 }, (_, index) => ({
              id: String(index + 201),
              authorId: "friend",
            })),
          );
          setReady(true);
        }, 120);
      },
    };
  }, [requests]);
  return h(
    "section",
    {
      className: "chat",
      style: { height: 320, width: 580, maxWidth: "100vw" },
    },
    h(
      ChatHistory,
      {
        key: thread,
        threadId: thread,
        messages,
        ready,
        ownUserId: "actor",
        hasMore: Number(messages[0]?.id) === 51,
        loadingOlder: loading,
        onLoadOlder: async () => {
          setRequests((count) => count + 1);
          setLoading(true);
          await new Promise((resolve) => setTimeout(resolve, 100));
          setMessages((current) => [
            ...Array.from({ length: 50 }, (_, index) => ({
              id: String(index + 1),
              authorId: "friend",
            })),
            ...current,
          ]);
          setLoading(false);
        },
      },
      messages.map((message) =>
        h(
          "article",
          {
            key: message.id,
            "data-message-id": message.id,
            className:
              message.authorId === "actor" ? "messageOwn" : "messageOther",
            style: { minHeight: 65 },
          },
          h(MessageHeader, {
            name: message.authorId,
            time: "12:00",
            onProfile() {},
          }),
          h("p", null, `Message ${message.id}`),
        ),
      ),
    ),
    h(
      "form",
      { onSubmit: (event) => event.preventDefault() },
      h("input", { "aria-label": "Message" }),
      h("button", { "data-chat-send": true, type: "submit" }, "Send"),
    ),
  );
}

window.verifyChatHistory = async () => {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    top: "0",
    left: "0",
    zIndex: "1000",
  });
  document.body.append(container);
  const root = createRoot(container);
  root.render(h(HistoryFixture));
  await wait();
  const log = () => container.querySelector(".chatLog");
  const atBottom = () =>
    Math.abs(log().scrollHeight - log().clientHeight - log().scrollTop) < 2;
  check(atBottom(), "History did not open at the latest message");
  check(
    !container.querySelector(".jumpToPresent"),
    "Jump arrow is shown while the latest message is visible",
  );
  const article = container.querySelector("article");
  const sender = article.querySelector(".profileLink");
  check(
    getComputedStyle(article).textAlign === "left" &&
      article.getBoundingClientRect().left <
        log().getBoundingClientRect().left + 30,
    "Other users' messages must align left",
  );
  check(
    sender.getBoundingClientRect().right <=
      article.querySelector("time").getBoundingClientRect().left,
    "Incoming name and timestamp overlap",
  );
  window.historyTestActions.append();
  await wait();
  check(atBottom(), "New messages did not follow the bottom");
  log().scrollTop = 400;
  log().dispatchEvent(new Event("scroll", { bubbles: true }));
  const readingPosition = log().scrollTop;
  await wait();
  const jump = container.querySelector(
    '.jumpToPresent[aria-label="Jump to present"]',
  );
  check(
    jump,
    "Scrolling away from the latest message did not show the jump arrow",
  );
  const send = container
    .querySelector("[data-chat-send]")
    .getBoundingClientRect();
  const arrow = jump.getBoundingClientRect();
  check(
    arrow.bottom <= send.top &&
      Math.abs(arrow.left + arrow.width / 2 - send.left - send.width / 2) < 2,
    "Jump arrow is not above the Send button",
  );
  jump.click();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches)
    check(
      atBottom(),
      "Reduced-motion jumping must reach the latest message immediately",
    );
  for (
    let frame = 0;
    frame < 30 && (!atBottom() || container.querySelector(".jumpToPresent"));
    frame++
  )
    await wait();
  check(
    atBottom() && !container.querySelector(".jumpToPresent"),
    "Jump arrow did not return to the latest message and disappear",
  );
  log().scrollTop = readingPosition;
  log().dispatchEvent(new Event("scroll", { bubbles: true }));
  await wait();
  window.historyTestActions.append();
  await wait();
  check(
    Math.abs(log().scrollTop - readingPosition) < 2,
    "Incoming message interrupted reading older history",
  );
  log().scrollTop = 0;
  log().dispatchEvent(new Event("scroll", { bubbles: true }));
  const anchor = container.querySelector('[data-message-id="51"]');
  const offset =
    anchor.getBoundingClientRect().top - log().getBoundingClientRect().top;
  for (let index = 0; index < 4; index++)
    log().dispatchEvent(new Event("scroll", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 180));
  check(
    window.historyTestActions.requests === 1,
    "Repeated top scroll events duplicated an older-page request",
  );
  check(
    container.querySelectorAll("article").length === 102,
    "Older page was not prepended",
  );
  check(
    Math.abs(
      anchor.getBoundingClientRect().top -
        log().getBoundingClientRect().top -
        offset,
    ) < 2,
    "Prepending older messages shifted the visible anchor",
  );
  window.historyTestActions.append("actor");
  await wait();
  const outgoing = container.querySelector("article.messageOwn");
  const incomingRows = [...container.querySelectorAll("article.messageOther")];
  check(
    incomingRows.every(
      (row) => row.dataset.messageTone === incomingRows[0].dataset.messageTone,
    ) &&
      outgoing.dataset.messageTone !== incomingRows.at(-1).dataset.messageTone,
    "Message background must change with the author, rather than with every row",
  );
  check(
    outgoing &&
      Math.abs(
        outgoing.getBoundingClientRect().width -
          article.getBoundingClientRect().width,
      ) < 2 &&
      getComputedStyle(outgoing).textAlign === "right" &&
      getComputedStyle(outgoing.querySelector("p")).textAlign === "right" &&
      getComputedStyle(outgoing.querySelector(".messageHeader"))
        .justifyContent === "flex-end" &&
      outgoing.querySelector(".profileLink").getBoundingClientRect().left >
        article.getBoundingClientRect().left + article.clientWidth / 2,
    "Full-width own rows must align the name and message text to the right",
  );
  check(atBottom(), "Sending a message did not reveal the latest message");
  check(
    !container.querySelector(".jumpToPresent"),
    "Sending a message did not hide the jump arrow",
  );
  window.historyTestActions.append("actor");
  await wait();
  check(
    container.querySelectorAll("article.messageOwn")[1].dataset.messageTone ===
      outgoing.dataset.messageTone,
    "Consecutive own messages must keep the same background",
  );
  window.historyTestActions.switchThread();
  await wait();
  check(
    log().getAttribute("aria-busy") === "true" &&
      !container.querySelector("article"),
    "Conversation switch displayed stale messages while loading",
  );
  await new Promise((resolve) => setTimeout(resolve, 140));
  check(
    atBottom() &&
      container.querySelector("article").dataset.messageId === "201",
    "New conversation did not open at its latest messages",
  );
  root.unmount();
  container.remove();
};

window.verifySettingsAndProfileLayout = async () => {
  window.setProfileRelation("accepted");
  document.getElementById("user-settings").click();
  await wait();
  const dialog = document.querySelector("dialog");
  const content = dialog.querySelector(".settingsContent");
  const bounds = dialog.getBoundingClientRect();
  check(
    bounds.left >= 0 &&
      bounds.right <= innerWidth &&
      bounds.top >= 0 &&
      bounds.bottom <= innerHeight,
    "Settings exceed viewport",
  );
  check(
    content.scrollWidth <= content.clientWidth,
    "Settings content overflows horizontally",
  );
  dialog.querySelector(".settingsClose").click();
  await wait();
  const trigger = document.getElementById("open-profile");
  trigger.focus();
  trigger.click();
  await wait();
  const profile = document.querySelector("dialog");
  check(
    profile.textContent.includes("Lovro") &&
      profile.textContent.includes("Test server"),
    "Profile identity or shared server is missing",
  );
  window.setWorkspaceProfileStatus("dnd");
  await wait();
  check(
    profile.querySelector(".profilePresence").textContent === "dnd",
    "Open profile did not reflect presence changes",
  );
  check(
    profile.getBoundingClientRect().right <= innerWidth,
    "Profile exceeds viewport",
  );
  profile.querySelector(".primary").click();
  await wait();
  check(
    window.profileMessageClicked && !document.querySelector("dialog"),
    "Profile message action failed",
  );
  check(
    document.activeElement === trigger,
    "Profile did not restore trigger focus",
  );
  window.setProfileRelation("none");
  trigger.click();
  await wait();
  const stranger = document.querySelector("dialog");
  check(
    stranger.querySelector(".primary").textContent === "Add friend",
    "Non-friend profile has no Add friend action",
  );
  window.rejectProfileRequest = true;
  stranger.querySelector(".primary").click();
  await wait();
  check(
    stranger.querySelector(".primary").disabled,
    "Friend request is not disabled while sending",
  );
  await new Promise((resolve) => setTimeout(resolve, 140));
  check(
    stranger.querySelector('[role="alert"]')?.textContent === "Request failed",
    "Friend request error is not visible in the profile",
  );
  window.rejectProfileRequest = false;
  stranger.querySelector(".primary").click();
  await new Promise((resolve) => setTimeout(resolve, 180));
  check(
    stranger.querySelector(".profileActions button").disabled &&
      stranger.textContent.includes("Friend request sent"),
    "Sent request did not change to pending",
  );
  window.setProfileRelation("incoming");
  await wait();
  check(
    stranger.querySelector(".primary").textContent === "Accept friend request",
    "Incoming friend request cannot be accepted",
  );
  stranger.querySelector(".primary").click();
  await wait();
  check(
    stranger.querySelector(".primary").textContent === "Message",
    "Accepting a friend request did not enable messaging",
  );
  stranger.querySelector(".settingsClose").click();
  await wait();
};
