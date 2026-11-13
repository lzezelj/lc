import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  SettingsModal,
  SettingsIcon,
  SettingsNameForm,
} from "./settings-modal.js";
import { UserProfile } from "./user-profile.js";
import { ChannelManager } from "./channel-manager.js";
import {
  useDragReorder,
  ReorderHandle,
  ReorderStatus,
} from "./drag-reorder.js";
import { moveRelative } from "./list-order.js";
import { MessageDeleteAction } from "./message-delete-action.js";
import { ChatHistory } from "./chat-history.js";
import { MessageComposer } from "./message-composer.js";
import { MessageReactions, MessageReactionMenu } from "./message-reactions.js";
import { useMessageReactions } from "./use-message-reactions.js";
import { useTyping } from "./use-typing.js";
import { useConversationDraft } from "./use-conversation-draft.js";
import { Avatar } from "./avatar.js";
import { CameraMirrorProcessor } from "./camera-processing.js";
import { CameraMirrorControl } from "./camera-mirror.js";
import { EchoCancellationToggle } from "./microphone-processing.js";
import { StatusAvatar } from "./status-avatar.js";
import { LocallyMuted } from "./locally-muted.js";
import { ProfilePictureSettings } from "./profile-picture-settings.js";
import { createAudioTransmissionGate } from "./audio-transmission.js";
import {
  ParticipantAudioControls,
  useParticipantAudio,
} from "./participant-audio.js";
import { UnreadIndicator } from "./unread-indicator.js";
import { MentionText } from "./mention-text.js";
import {
  NotificationSettings,
  NotificationMuteMenu,
} from "./notification-settings.js";
import { useNotificationInbox } from "./use-notification-inbox.js";
import { ConversationSearch } from "./conversation-search.js";
import { WorkspaceLinks } from "./workspace-links.js";
import { MessageAttachments } from "./message-attachments.js";
import { ParticipantMediaIndicators } from "./participant-media-indicators.js";
import { PanelToggle } from "./panel-toggle.js";
import { ServerInvites } from "./server-invites.js";
import { useServerInvitations } from "./use-server-invitations.js";
import { PendingServerInvitations } from "./pending-server-invitations.js";
import { ServerLeaveConfirmation } from "./server-leave-confirmation.js";
import { SettingsNavigation } from "./settings-navigation.js";
import { PersonalMessages } from "./personal-messages.js";
import { SessionCache } from "./conversation-cache.js";
import { AccountDeletion } from "./account-deletion.js";
import { SettingsMembers } from "./settings-members.js";
import { revealSettingsSection } from "./settings-reveal.js";
import { StreamVolume } from "./stream-volume.js";
import {
  CameraResolutionSelection,
  cameraCaptureConstraints,
} from "./camera-resolution.js";
import { reserveScreenAudio } from "./screen-audio.js";
import {
  StreamInfo,
  fullscreenVideoTile,
  directionalStreamStats,
} from "./stream-info.js";
import { ScreenShareOptions } from "./screen-share-options.js";
import { EmptyState } from "./empty-state.js";
import { useMessageCooldown } from "./use-message-cooldown.js";
import { MessageHeader } from "./message-header.js";
import { SidebarResizer } from "./sidebar-resizer.js";
import { LegalFrame } from "./legal-frame.js";
import { DiagnosticsIndicator } from "./diagnostics.js";
import { DeviceMenu } from "./device-menu.js";
import { DeviceSelection } from "./device-selection.js";
import { AudioDeviceOptions } from "./audio-device-options.js";
import { UserStatusMenu } from "./user-status-menu.js";
import { CallMediaProvider, useCallAudio } from "./call-media.js";
import { SoundboardButton, useSoundboard } from "./soundboard.js";
import { SoundManager } from "./sound-manager.js";
import { ServerNavButton, preloadServerPictures } from "./server-nav-button.js";
import { VoiceParticipantMenu } from "./voice-participant-menu.js";
import { HelpTour, helpSteps } from "./help-tour.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { useWorkspaceActivity } from "./use-workspace-activity.js";
import { IncomingCallNotice } from "./incoming-call-notice.js";
import { friendCallRoom, conversationHasCall } from "./call-context.js";
import { soundWave } from "./soundboard-catalog.js";
import { SoundPlayer } from "./soundboard-audio.js";
import { RemoteAudioTrack } from "livekit-client";
import { applyRemoteAudioVolume } from "./remote-audio-volume.js";

const h = React.createElement;
const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
const check = (value, message) => {
  if (!value) throw new Error(message);
};

window.verifyVideoAttachments = async () => {
  await verifyScreenShareOptions();
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext("2d");
  context.fillStyle = "#78a4ff";
  context.fillRect(0, 0, 160, 90);
  const capture = canvas.captureStream(5);
  const recorder = new MediaRecorder(capture, {
    mimeType: "video/webm;codecs=vp8",
  });
  const chunks = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = reject;
  });
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, 250));
  context.fillStyle = "#ed5965";
  context.fillRect(0, 0, 160, 90);
  await new Promise((resolve) => setTimeout(resolve, 250));
  recorder.stop();
  await stopped;
  capture.getTracks().forEach((track) => track.stop());
  const file = new File(chunks, "clip.webm", { type: "video/webm" });
  const url = URL.createObjectURL(file);
  const host = document.createElement("section");
  host.className = "chat";
  host.style.cssText =
    "position:fixed;inset:16px;z-index:1000;display:block;overflow:auto";
  document.body.append(host);
  const root = createRoot(host);
  let submissions = 0;
  function Composer() {
    const [files, setFiles] = useState([]);
    return h(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          submissions++;
        },
      },
      h(MessageComposer, {
        value: "",
        onChange() {},
        files,
        onFiles: setFiles,
        placeholder: "Video draft",
        progress: null,
      }),
      h("button", { type: "submit" }, "Send"),
    );
  }
  const loaded = async (video) => {
    video.muted = true;
    for (
      let count = 0;
      count < 50 && video.readyState < 2 && !video.error;
      count++
    )
      await wait();
    check(
      video.readyState >= 2 && video.videoWidth === 160,
      "Video decodes in the browser",
    );
  };
  const render = (content) =>
    flushSync(() => root.render(h(React.StrictMode, null, content)));
  try {
    render(h(Composer));
    const picker = host.querySelector('input[type="file"]');
    check(
      picker.accept.includes("video/mp4") &&
        picker.accept.includes("video/webm"),
      "Picker accepts supported videos",
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    picker.files = transfer.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    const pending = host.querySelector(".pendingVideo");
    await loaded(pending);
    const trigger = host.querySelector(".pendingImageButton");
    trigger.focus();
    trigger.click();
    await wait();
    let dialog = document.querySelector(".attachmentPreviewModal[open]");
    let preview = dialog.querySelector("video");
    await loaded(preview);
    await preview.play();
    check(
      preview.controls && !preview.paused && submissions === 0,
      "Draft videos preview without uploading or submitting",
    );
    dialog.querySelector('[aria-label="Close video preview"]').click();
    await wait();
    check(
      preview.paused &&
        !preview.getAttribute("src") &&
        document.activeElement === trigger,
      "Closing a video preview stops playback and restores focus",
    );
    host.querySelector('[aria-label="Remove clip.webm"]').click();
    await wait();
    check(
      !host.querySelector(".pendingVideo") &&
        pending.paused &&
        !pending.getAttribute("src"),
      "Removing a draft releases its video source",
    );
    const metadata = [
      { id: "video-test", name: file.name, type: file.type, size: file.size },
    ];
    render(h(MessageAttachments, { files: metadata }));
    const inline = host.querySelector("video");
    check(
      inline.getAttribute("src") === "/api/attachments/video-test",
      "Effect replay preserves the sent video's source",
    );
    inline.src = url;
    check(
      !inline.controls &&
        inline.muted &&
        !inline.autoplay &&
        inline.preload === "metadata" &&
        inline.closest(".attachmentThumbnail") &&
        !host.querySelector(".attachmentFileRow"),
      "Sent videos use the same thumbnail layout as pictures without inline controls or file details",
    );
    await loaded(inline);
    const open = host.querySelector('[aria-label="Preview clip.webm"]');
    open.focus();
    open.click();
    await wait();
    check(inline.paused, "The thumbnail remains paused when its preview opens");
    dialog = document.querySelector(".attachmentPreviewModal[open]");
    preview = dialog.querySelector("video");
    preview.src = url;
    await loaded(preview);
    await preview.play();
    check(
      dialog.getBoundingClientRect().width <= innerWidth &&
        preview.getBoundingClientRect().width <=
          dialog.getBoundingClientRect().width,
      "Video window stays inside desktop/mobile viewport",
    );
    preview.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    );
    await wait();
    check(
      dialog.querySelector(".imageDownloadMenu a").getAttribute("href") ===
        "/api/attachments/video-test?download=1",
      "Video preview shares the picture download menu and authorized attachment endpoint",
    );
    render(
      h(MessageAttachments, {
        files: metadata,
        deleted: true,
      }),
    );
    check(
      !document.querySelector(".attachmentPreviewModal") &&
        !host.querySelector("video") &&
        inline.paused &&
        preview.paused &&
        !inline.getAttribute("src") &&
        !preview.getAttribute("src"),
      "Deleting a video message stops and releases both players",
    );
    render(h(MessageAttachments, { files: metadata }));
    host.querySelector('[aria-label="Preview clip.webm"]').click();
    await wait();
    preview = document.querySelector(".attachmentPreviewModal video");
    preview.src = url;
    await loaded(preview);
    await preview.play();
    render(
      h(MessageAttachments, {
        files: metadata.map((file) => ({ ...file, expired: true })),
      }),
    );
    check(
      !document.querySelector(".attachmentPreviewModal") &&
        preview.paused &&
        !preview.getAttribute("src"),
      "Expiry closes and stops the video",
    );
    check(
      host.textContent.includes("Attachment expired") &&
        !host.querySelector(".attachmentDownload") &&
        !host.querySelector("video"),
      "Expired attachments retain a label without playback or download",
    );
    const mixed = [
      { id: "photo-test", name: "photo.png", type: "image/png", size: 1 },
      ...metadata,
      { ...metadata[0], id: "second-video", name: "second.webm" },
    ];
    render(h(MessageAttachments, { key: "mixed", files: mixed }));
    await wait();
    host.querySelector(".attachmentOverflow").click();
    await wait();
    const gallery = document.querySelector(".attachmentGalleryModal");
    check(
      gallery.querySelectorAll(".attachmentThumbnail img").length === 1 &&
        gallery.querySelectorAll(".attachmentVideoThumbnail").length === 2,
      "Pictures and videos share the same overflow gallery",
    );
    gallery.querySelector('[aria-label="Preview clip.webm"]').click();
    await wait();
    check(
      document.querySelector(".attachmentPreviewModal video")?.controls,
      "A gallery video opens the full player",
    );
    render(
      h(MessageAttachments, { key: "mixed", files: mixed, deleted: true }),
    );
    check(
      !document.querySelector(
        ".attachmentGalleryModal, .attachmentPreviewModal",
      ),
      "Deleting mixed media closes the gallery and player",
    );
    return {
      stagedVideo: true,
      playback: true,
      previewWindow: true,
      cleanup: true,
      deletionCleanup: true,
      noAutoplay: true,
      download: true,
    };
  } finally {
    root.unmount();
    host.remove();
    URL.revokeObjectURL(url);
  }
};

window.verifyPanelAnimations = async () => {
  await verifyPanelToggleStates();
  const workspace = document.createElement("div");
  workspace.className = "workspace";
  workspace.style.cssText = "position:fixed;inset:0;z-index:1000";
  workspace.innerHTML =
    '<aside class="workspaceRail"></aside><aside class="channelSidebar"></aside><section class="room"><audio></audio></section><aside class="memberSidebar"></aside>';
  document.body.append(workspace);
  const media = workspace.querySelector("audio");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settle = () => new Promise((resolve) => setTimeout(resolve, 240));
  try {
    await settle();
    for (const friends of [false, true]) {
      workspace.classList.toggle("friendsScreen", friends);
      for (const [toggle, selector, property, defaultOpen] of [
        [
          "serverListToggled",
          ".workspaceRail",
          "--rail-width",
          innerWidth > 650,
        ],
        ["channelsHidden", ".channelSidebar", "--channel-width", true],
        [
          "userListToggled",
          ".memberSidebar",
          "--member-width",
          innerWidth > 920,
        ],
      ]) {
        const panel = workspace.querySelector(selector);
        for (const toggled of [true, false]) {
          const before = parseFloat(
            getComputedStyle(workspace).getPropertyValue(property),
          );
          workspace.classList.toggle(toggle, toggled);
          const open = toggled ? !defaultOpen : defaultOpen;
          await new Promise((resolve) =>
            setTimeout(resolve, reduced ? 20 : 70),
          );
          if (!reduced && (selector !== ".memberSidebar" || innerWidth > 920)) {
            const during = parseFloat(
              getComputedStyle(workspace).getPropertyValue(property),
            );
            check(
              during > 0 && Math.abs(during - before) > 0.1,
              "Panel widths interpolate during toggles",
            );
          }
          await settle();
          check(
            getComputedStyle(panel).visibility ===
              (open ? "visible" : "hidden"),
            "Panel visibility follows desktop/mobile toggle state",
          );
          check(
            getComputedStyle(panel).display !== "none",
            "Panel content remains mounted through both animation directions",
          );
          if (!open)
            check(
              getComputedStyle(panel).pointerEvents === "none",
              "Hidden panels do not intercept clicks",
            );
          check(
            workspace.querySelector("audio") === media,
            "Panel toggles retain the media element",
          );
        }
      }
    }
    const resizer = document.createElement("div");
    resizer.className = "sidebarResizer";
    resizer.tabIndex = 0;
    workspace.querySelector(".channelSidebar").append(resizer);
    if (innerWidth > 650) {
      resizer.focus();
      check(
        getComputedStyle(workspace).transitionDuration === "0s",
        "Sidebar resizing bypasses panel width animations",
      );
    }
    if (reduced)
      check(
        getComputedStyle(workspace)
          .getPropertyValue("--panel-duration")
          .trim() === "0ms",
        "Reduced motion disables panel delays",
      );
    return {
      bothDirections: true,
      friendsAndServers: true,
      mountedMedia: true,
      reducedMotion: reduced,
    };
  } finally {
    workspace.remove();
  }
};

window.verifyWorkspaceLayout = async () => {
  const audio = window.workspaceAudio.element;
  const stream = audio.srcObject;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    for (const documentName of ["impressum", "privacy", "licenses"]) {
      function Fixture() {
        const [open, setOpen] = useState(true);
        return open
          ? h(LegalFrame, {
              document: documentName,
              title: documentName,
              onClose: () => {
                setOpen(false);
              },
            })
          : null;
      }
      flushSync(() => root.render(h(Fixture, { key: documentName })));
      const frame = host.querySelector("iframe");
      const frameLoaded = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${documentName} fixture did not load`)),
          3000,
        );
        frame.addEventListener(
          "load",
          () => {
            clearTimeout(timer);
            setTimeout(resolve, 0);
          },
          { once: true },
        );
      });
      await frameLoaded;
      for (
        let attempt = 0;
        attempt < 30 && !frame.contentDocument?.querySelector("a");
        attempt++
      )
        await wait();
      const click = new frame.contentWindow.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      frame.contentDocument.querySelector("a span").dispatchEvent(click);
      await wait();
      check(
        click.defaultPrevented && !host.querySelector("iframe"),
        `${documentName}: Back to LC closes the document instead of loading a nested app`,
      );
    }
  } finally {
    root.unmount();
    host.remove();
  }
  const soundHost = document.createElement("div");
  soundHost.className = "workspace";
  soundHost.style.cssText =
    "position:fixed;top:0;left:0;width:320px;height:56px;display:block;z-index:1000";
  document.body.append(soundHost);
  const soundRoot = createRoot(soundHost);
  try {
    flushSync(() =>
      soundRoot.render(
        h(
          "div",
          {
            className: "controls voiceDock",
            style: {
              position: "static",
              width: "90px",
              gridTemplateColumns: "minmax(0, 1fr)",
            },
          },
          h(SoundboardButton, {
            board: { open: false, setOpen() {} },
            serverId: "layout-test",
            disabled: false,
            publish: async () => () => {},
          }),
        ),
      ),
    );
    const label = soundHost.querySelector(".soundboardButton .soundName");
    check(
      label.title === "Soundboard" &&
        label.scrollWidth > label.clientWidth &&
        getComputedStyle(label).textOverflow === "ellipsis",
      "Soundboard button uses an ellipsis and exposes its full hover title",
    );
  } finally {
    soundRoot.unmount();
    soundHost.remove();
  }
  const workspace = document.querySelector(".workspace");
  const channelHandle = workspace.querySelector(
    '[aria-label="Resize channel list"]',
  );
  if (innerWidth > 920) {
    channelHandle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check(
      workspace.querySelector(".channelSidebar").getBoundingClientRect()
        .width === 320,
      "Channel sidebar clamps to the wider 320px minimum",
    );
    const avatar = workspace
      .querySelector(".profileStatusTrigger .userAvatar")
      .getBoundingClientRect();
    const microphone = workspace
      .querySelector(".voiceDock .mediaToggle")
      .getBoundingClientRect();
    check(
      avatar.width >= 32 &&
        avatar.right < microphone.left &&
        document
          .elementFromPoint(
            avatar.left + avatar.width / 2,
            avatar.top + avatar.height / 2,
          )
          ?.closest(".profileStatusTrigger"),
      "The profile picture stays whole and clear of microphone controls at minimum width",
    );
    const members = workspace.querySelector(".memberSidebar"),
      handle = members.querySelector('[aria-label="Resize All users"]');
    handle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    const before = members.getBoundingClientRect().width;
    handle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowLeft",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check(
      members.getBoundingClientRect().width === before + 10,
      "Dragging direction and keyboard arrows grow All users from its left edge",
    );
    handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    channelHandle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await wait();
  }
  check(
    window.workspaceAudio.element === audio &&
      audio.srcObject === stream &&
      !audio.paused,
    "Closing legal windows and resizing sidebars preserve call playback",
  );
  return {
    legalBack: true,
    widerMinimum: true,
    membersResizable: true,
    soundboardEllipsis: true,
    callPreserved: true,
  };
};

window.verifyParticipantAudio = async () => {
  await verifyParticipantControls();
  await verifyParticipantIndicators();
  return {
    personalControls: true,
    serverControls: true,
    policyPrecedence: true,
    redIndicators: true,
    nameOverflow: true,
  };
};

window.verifyServerInvitations = async () => {
  await verifyServerPictureLoading();
  await verifyServerLeaveConfirmation();
  await verifyInvitesAndReveal();
  const host = document.createElement("div"),
    original = window.fetch;
  host.className = "friendsRoom";
  document.body.append(host);
  const root = createRoot(host),
    joins = [],
    actions = [],
    runtimeErrors = [];
  const recordError = (event) => runtimeErrors.push(event.message);
  window.addEventListener("error", recordError);
  let current, hold, release;
  const incoming = {
    id: "incoming",
    serverId: "one",
    serverName: "Incoming server",
    serverImage:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=",
    inviterId: "sender",
    inviterName: "Sender",
    recipientId: "viewer",
    recipientName: "Viewer",
    incoming: true,
  };
  const sent = {
    ...incoming,
    id: "sent",
    serverId: "two",
    serverName: "Sent server",
    incoming: false,
  };
  let rows = [incoming, sent];
  window.fetch = async (url, options) => {
    check(
      url === "/api/server-invitations",
      "Pending server invites use their authenticated endpoint",
    );
    if (options?.method === "PATCH") {
      const body = JSON.parse(options.body);
      actions.push(body);
      rows = rows.filter((row) => row.id !== body.id);
      return Response.json({ accepted: body.action === "accept" });
    }
    if (hold)
      await new Promise((resolve) => {
        release = resolve;
      });
    return Response.json(rows);
  };
  function Fixture({ account = "viewer" }) {
    const invitations = useServerInvitations(account, (serverId, userId) =>
      joins.push({ serverId, userId }),
    );
    React.useLayoutEffect(() => {
      current = invitations;
    });
    return h(
      React.Fragment,
      {},
      ...[true, false].map((incoming) =>
        h(
          "section",
          {
            key: String(incoming),
            "aria-label": incoming ? "Incoming" : "Outgoing",
          },
          h(PendingServerInvitations, { invitations, incoming }),
        ),
      ),
    );
  }
  const button = (text) =>
    [...host.querySelectorAll("button")].find(
      (item) => item.textContent === text,
    );
  try {
    flushSync(() => root.render(h(Fixture, {})));
    await wait();
    check(
      host.textContent.includes("Incoming server") &&
        host.textContent.includes("Sent server") &&
        button("Accept") &&
        button("Decline") &&
        button("Cancel invite"),
      "Pending list separates recipient actions from sender cancellation",
    );
    check(
      host
        .querySelector('[aria-label="Incoming"]')
        .textContent.includes("Incoming server") &&
        !host
          .querySelector('[aria-label="Incoming"]')
          .textContent.includes("Sent server") &&
        host
          .querySelector('[aria-label="Outgoing"]')
          .textContent.includes("Sent server"),
      "Incoming and outgoing server invites render in separate groups",
    );
    check(
      host.querySelector(".serverPicture img")?.getAttribute("src") ===
        incoming.serverImage,
      "Invites show the server picture",
    );
    const pictureBounds = host
      .querySelector(".serverPicture")
      .getBoundingClientRect();
    check(
      pictureBounds.width === 36 && pictureBounds.height === 36,
      "Pending invitation pictures retain a fixed square size",
    );
    button("Accept").click();
    await wait();
    check(
      joins.length === 1 &&
        joins[0].serverId === "one" &&
        joins[0].userId === "viewer" &&
        !host.textContent.includes("Incoming server"),
      "Acceptance refreshes membership once and removes the pending invitation",
    );
    window.dispatchEvent(
      new CustomEvent("lc-server-invitations", {
        detail: { invitationId: "incoming", serverId: "one", userId: "viewer" },
      }),
    );
    await wait();
    check(
      joins.length === 1,
      "An echoed acceptance cannot refresh access twice",
    );
    button("Cancel invite").click();
    await wait();
    check(
      actions.at(-1).action === "cancel" && joins.length === 1,
      "Sender cancellation does not grant access",
    );
    rows = [incoming];
    await current.refresh();
    await wait();
    button("Decline").click();
    await wait();
    check(
      actions.at(-1).action === "decline" &&
        joins.length === 1 &&
        !host.querySelector(".friendRow"),
      "Declining clears the invitation without joining",
    );
    rows = [incoming];
    await current.refresh();
    await wait();
    hold = true;
    window.dispatchEvent(new CustomEvent("lc-server-invitations"));
    await wait();
    check(
      runtimeErrors.length === 0,
      "Connection refresh with null event detail cannot throw a runtime error",
    );
    check(
      host.textContent.includes("Incoming server"),
      "Background refresh retains the loaded invitation list",
    );
    hold = false;
    release();
    await wait();
    hold = true;
    flushSync(() => root.render(h(Fixture, { account: "someone-else" })));
    await wait();
    check(
      !host.textContent.includes("Incoming server"),
      "Pending invitations never leak across accounts",
    );
    hold = false;
    rows = [];
    release();
    await wait();
    return {
      send: true,
      accept: true,
      decline: true,
      cancel: true,
      backgroundRefresh: true,
      accountIsolation: true,
    };
  } finally {
    root.unmount();
    host.remove();
    window.removeEventListener("error", recordError);
    window.fetch = original;
  }
};

async function verifyServerLeaveConfirmation() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const confirmed = [];
  let closed = 0,
    release;
  const server = { id: "captured-server", name: "Server to leave" };
  const render = (key, onConfirm) =>
    flushSync(() =>
      root.render(
        h(ServerLeaveConfirmation, {
          key,
          server,
          onConfirm,
          onClose: () => closed++,
        }),
      ),
    );
  try {
    render("cancel", async (id) => confirmed.push(id));
    await wait();
    let dialog = document.querySelector("dialog[open]");
    check(
      dialog.textContent.includes(server.name) && confirmed.length === 0,
      "Opening leave confirmation cannot remove membership",
    );
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "Cancel")
      .click();
    check(
      closed === 1 && confirmed.length === 0,
      "Cancel leaves the server membership untouched",
    );
    render("escape", async (id) => confirmed.push(id));
    await wait();
    document
      .querySelector("dialog[open]")
      .dispatchEvent(new Event("cancel", { cancelable: true }));
    check(closed === 2 && confirmed.length === 0, "Escape cancels leaving");
    render("failure", async () => {
      throw new Error("Demo accounts must retain at least one server.");
    });
    await wait();
    document.querySelector("dialog[open] button.danger").click();
    await wait();
    check(
      document
        .querySelector('dialog[open] [role="alert"]')
        .textContent.includes("Demo accounts") && closed === 2,
      "Backend leave errors stay in the confirmation dialog",
    );
    render("confirm", async (id) => {
      confirmed.push(id);
      await new Promise((resolve) => {
        release = resolve;
      });
    });
    await wait();
    dialog = document.querySelector("dialog[open]");
    const leave = dialog.querySelector("button.danger");
    const color = getComputedStyle(leave)
      .backgroundColor.match(/\d+/g)
      .map(Number);
    check(
      color[0] > color[1] * 1.5 && color[0] > color[2],
      "The destructive confirmation button is red",
    );
    leave.click();
    leave.click();
    await wait();
    check(
      confirmed.length === 1 && confirmed[0] === server.id && leave.disabled,
      "Confirmation captures the intended server and prevents duplicate leave requests",
    );
    release();
    await wait();
    check(closed === 3, "Successful leave closes confirmation");
    flushSync(() =>
      root.render(
        h(ServerNavButton, {
          server: {
            ...server,
            image:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=",
          },
          voiceUsers: [],
          onClick() {},
          onContextMenu() {},
        }),
      ),
    );
    await wait();
    check(
      host.querySelector(".workspaceButton .serverPicture img"),
      "Server rail renders the server picture",
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

async function verifyServerPictureLoading() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const originalDecode = HTMLImageElement.prototype.decode;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  const sources = ["red", "blue"].map((color) => {
    canvas.getContext("2d").fillStyle = color;
    canvas.getContext("2d").fillRect(0, 0, 2, 2);
    return canvas.toDataURL();
  });
  const pending = new Map();
  HTMLImageElement.prototype.decode = async function () {
    const source = this.getAttribute("src");
    await originalDecode.call(this);
    if (sources.includes(source))
      await new Promise((resolve) => pending.set(source, resolve));
  };
  const render = (image) =>
    flushSync(() =>
      root.render(
        h(ServerNavButton, {
          server: { id: "loading", name: "Loading server", image },
          voiceUsers: [],
          onClick() {},
          onContextMenu() {},
        }),
      ),
    );
  const decoding = async (source) => {
    for (let i = 0; i < 30 && !pending.has(source); i++) await wait();
    check(
      pending.has(source),
      "Picture reaches decoding before it is revealed",
    );
  };
  try {
    preloadServerPictures([{ image: sources[0] }, { image: null }]);
    check(
      [...document.querySelectorAll('link[rel="preload"][as="image"]')].some(
        (link) =>
          link.getAttribute("href") === sources[0] &&
          link.referrerPolicy === "no-referrer",
      ),
      "Server pictures preload with the rendered image request policy",
    );
    render(sources[0]);
    await decoding(sources[0]);
    const icon = host.querySelector(".serverPicture");
    const before = icon.getBoundingClientRect();
    check(
      icon.textContent === "L" &&
        getComputedStyle(icon.querySelector("img")).opacity === "0" &&
        getComputedStyle(icon.querySelector(".avatarInitial")).visibility ===
          "visible",
      "Slow pictures keep a visible initial until decoding finishes",
    );
    render(sources[1]);
    await decoding(sources[1]);
    pending.get(sources[1])();
    await wait();
    check(
      icon.classList.contains("avatarImageReady") &&
        getComputedStyle(icon.querySelector(".avatarInitial")).visibility ===
          "hidden",
      "A decoded picture replaces its initial",
    );
    pending.get(sources[0])();
    await wait();
    check(
      icon.classList.contains("avatarImageReady") &&
        icon.querySelector("img").getAttribute("src") === sources[1],
      "A late decode cannot hide or replace a newer picture",
    );
    const after = icon.getBoundingClientRect();
    check(
      before.width === 46 &&
        before.height === 46 &&
        after.width === before.width &&
        after.height === before.height,
      "Picture loading preserves the server icon dimensions",
    );
    render("data:image/png;base64,invalid");
    await wait();
    check(
      !icon.querySelector("img") &&
        icon.textContent === "L" &&
        getComputedStyle(icon.querySelector(".avatarInitial")).visibility ===
          "visible",
      "Broken pictures retain initials",
    );
  } finally {
    HTMLImageElement.prototype.decode = originalDecode;
    for (const release of pending.values()) release();
    root.unmount();
    host.remove();
  }
}

window.verifyOrderAndDeviceSettings = async () => {
  const host = document.createElement("section");
  host.className = "workspace settingsModal";
  host.style.cssText =
    "position:fixed;inset:12px;width:auto;display:block;overflow:auto;z-index:10000;padding:12px";
  document.body.append(host);
  const root = createRoot(host);
  const initial = [
    { id: "a", name: "Text A", type: "text" },
    { id: "voice", name: "Voice A", type: "voice_direct" },
    { id: "b", name: "Text B", type: "text" },
    { id: "c", name: "Text C", type: "text" },
  ];
  let fail = false;
  function Fixture() {
    const [channels, setChannels] = useState(initial),
      [servers, setServers] = useState([
        { id: "one", name: "One" },
        { id: "two", name: "Two" },
      ]);
    const drag = useDragReorder({
      items: servers,
      scope: "servers",
      onReorder: async (id, targetId, placement) =>
        setServers((rows) => moveRelative(rows, id, targetId, placement)),
    });
    return h(
      React.Fragment,
      null,
      h(
        "div",
        { className: "controls" },
        h(DeviceMenu, {
          kind: "camera",
          devices: [{ deviceId: "camera", label: "Camera" }],
          selectedId: "camera",
          onAction() {},
          onSelect() {},
          extraOptions: h(
            React.Fragment,
            null,
            h(CameraResolutionSelection, {
              resolution: "720",
              frameRate: 30,
              onChange() {},
              onFrameRateChange() {},
            }),
            h(CameraMirrorControl),
          ),
        }),
        h(DeviceMenu, {
          kind: "microphone",
          devices: [],
          selectedId: "",
          onAction() {},
          onSelect() {},
        }),
      ),
      h(ChannelManager, {
        channels,
        onRename: async () => {},
        onDelete: async () => {},
        onReorder: async (target, targetId, placement) => {
          if (fail) throw new Error("Only the server owner can move channels");
          setChannels((rows) => {
            const sameGroup = (row) =>
              (row.type === "text") === (target.type === "text");
            const moved = moveRelative(
              rows.filter(sameGroup),
              target.id,
              targetId,
              placement,
            );
            return [...moved, ...rows.filter((row) => !sameGroup(row))];
          });
        },
      }),
      h(
        "div",
        { "data-server-moves": true },
        h(ReorderStatus, { drag }),
        ...servers.map((server) =>
          h(
            "div",
            { key: server.id, ...drag.itemProps(server.id) },
            server.name,
            h(ReorderHandle, { drag, id: server.id }),
          ),
        ),
      ),
      h(
        "output",
        { "data-server-order": true },
        servers.map((row) => row.id).join(","),
      ),
    );
  }
  try {
    flushSync(() => root.render(h(Fixture)));
    host.querySelector('[aria-label="Choose camera"]').click();
    await wait();
    let panel = document.querySelector(".deviceDropdownPortal");
    const selectors = [...panel.querySelectorAll("select")],
      mirror = panel.querySelector(".cameraMirrorControl");
    const bounds = mirror.getBoundingClientRect();
    check(
      selectors.length === 3 &&
        selectors.every(
          (select) =>
            Math.abs(select.getBoundingClientRect().left - bounds.left) < 1 &&
            Math.abs(select.getBoundingClientRect().width - bounds.width) < 1,
        ),
      "Camera dropdowns and Mirror camera share the same width and horizontal edges",
    );
    check(
      selectors.every(
        (select) =>
          select.compareDocumentPosition(mirror) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      "Camera dropdown settings appear together before on/off settings",
    );
    host.querySelector('[aria-label="Choose camera"]').click();
    await wait();
    host.querySelector('[aria-label="Choose microphone"]').click();
    await wait();
    panel = document.querySelector(".deviceDropdownPortal");
    const toggle = panel.querySelector(".rnnoiseToggle");
    check(
      [...panel.querySelectorAll("select")].every(
        (select) =>
          select.compareDocumentPosition(toggle) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      "Microphone dropdown settings precede on/off settings",
    );
    host.querySelector('[aria-label="Choose microphone"]').click();
    await wait();
    const key = async (name, value) => {
      const handle = host.querySelector(
        `[aria-label="Drag to reorder ${name}"]`,
      );
      handle.focus();
      handle.dispatchEvent(
        new KeyboardEvent("keydown", { key: value, bubbles: true }),
      );
      await wait();
    };
    check(
      host.querySelector('[aria-label="Drag to reorder Voice A"]').disabled,
      "Single voice channel cannot be moved",
    );
    check(
      !host.querySelector('[aria-label^="Move "]'),
      "Separate movement controls are removed",
    );
    await key("Text C", " ");
    await key("Text C", "ArrowUp");
    await key("Text C", "ArrowUp");
    await key("Text C", " ");
    check(
      [...host.querySelectorAll(".managedChannelHeading strong")]
        .map((node) => node.textContent)
        .join(",") === "Text C,Text A,Text B,Voice A",
      "One drop moves across multiple rows within its section",
    );
    await key("Text C", " ");
    await key("Text C", "ArrowDown");
    await key("Text C", "Escape");
    check(
      !host.querySelector("[data-reorder-drop]"),
      "Escape clears insertion markers",
    );
    const search = host.querySelector('input[type="search"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(search, "Text C");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    fail = true;
    await key("Text C", " ");
    await key("Text C", "ArrowDown");
    await key("Text C", " ");
    check(
      host.querySelector('[role="alert"]').textContent.includes("server owner"),
      "Failed saves are visible and retain order",
    );
    await key("Two", " ");
    await key("Two", "ArrowUp");
    await key("Two", " ");
    check(
      host.querySelector("[data-server-order]").textContent === "two,one",
      "Personal server drag order saves",
    );
    return {
      cameraWidths: true,
      groupedSettings: true,
      channelMoves: true,
      sectionBoundaries: true,
      searchBoundaries: true,
      errors: true,
      personalServerMoves: true,
    };
  } finally {
    root.unmount();
    host.remove();
  }
};

window.mountDragProbe = async (kind = "servers", long = false) => {
  const host = document.createElement("section");
  host.className = "workspace";
  host.style.cssText =
    "position:fixed;inset:12px;background:#181e2b;display:block;z-index:10000;padding:12px;overflow:auto";
  document.body.append(host);
  const root = createRoot(host);
  let clicks = 0,
    commits = 0;
  function Fixture() {
    const [rows, setRows] = useState([
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      ...(long
        ? Array.from({ length: 9 }, (_, index) => ({
            id: `extra-${index + 3}`,
            name: `Extra ${index + 3}`,
          }))
        : []),
    ]);
    const drag = useDragReorder({
      items: rows,
      scope: "probe",
      onReorder: async (id, target, placement) => {
        commits++;
        await new Promise((resolve) => setTimeout(resolve, 80));
        setRows((items) => moveRelative(items, id, target, placement));
      },
    });
    return h(
      "nav",
      {
        className: kind === "servers" ? "serverScroller" : "",
        style: { width: kind === "servers" ? 72 : 280, height: 220 },
      },
      h(ReorderStatus, { drag }),
      ...rows.map((row) =>
        kind === "channels"
          ? h(
              "div",
              {
                key: row.id,
                className: "channelRow",
                ...drag.itemProps(row.id),
              },
              h(ReorderHandle, { drag, id: row.id }),
              h(
                "button",
                {
                  className: "channel",
                  ...drag.pointerProps(row.id),
                  onClick: () => clicks++,
                },
                row.name,
              ),
            )
          : h(ServerNavButton, {
              key: row.id,
              server: row,
              drag,
              voiceUsers: [],
              onContextMenu: () => {},
              onClick: () => clicks++,
            }),
      ),
    );
  }
  flushSync(() => root.render(h(Fixture)));
  await wait();
  const originalRows = new Map(
    [...host.querySelectorAll("[data-reorder-id]")].map((node) => [
      node.dataset.reorderId,
      node,
    ]),
  );
  window.dragProbe = {
    scroll(top) {
      host.querySelector("nav").scrollTop = top;
    },
    async watchDrop() {
      const samples = [];
      const end = performance.now() + 350;
      while (performance.now() < end) {
        await new Promise(requestAnimationFrame);
        samples.push(this.read());
      }
      return samples;
    },
    points(id, target) {
      const row = host.querySelector(`[data-reorder-id="${id}"]`),
        destination = host.querySelector(`[data-reorder-id="${target}"]`);
      const from = row
          .querySelector("[data-reorder-icon], [data-reorder-handle]")
          .getBoundingClientRect(),
        to = destination.getBoundingClientRect();
      return {
        x: from.left + from.width / 2,
        y: from.top + from.height / 2,
        targetX: to.left + to.width / 2,
        targetY: to.bottom - 8,
      };
    },
    read() {
      return {
        order: [...host.querySelectorAll("[data-reorder-id]")]
          .map((row) => row.dataset.reorderId)
          .join(","),
        clicks,
        commits,
        positions: Object.fromEntries(
          [...host.querySelectorAll("[data-reorder-id]")].map((row) => [
            row.dataset.reorderId,
            row.getBoundingClientRect().top,
          ]),
        ),
        scrollHeight: host.querySelector("nav").scrollHeight,
        scrollTop: host.querySelector("nav").scrollTop,
        sameNodes: [...originalRows].every(
          ([id, node]) =>
            host.querySelector(`[data-reorder-id="${id}"]`) === node,
        ),
        offsets: [...host.querySelectorAll("[data-reorder-id]")].map(
          (row) =>
            Number.parseFloat(row.style.getPropertyValue("--reorder-offset")) ||
            0,
        ),
        grips: host.querySelectorAll(".reorderDragHandle").length,
        gripsInside: [...host.querySelectorAll(".reorderDragHandle")].every(
          (handle) => {
            const bounds = handle.getBoundingClientRect(),
              row = handle.parentElement.getBoundingClientRect();
            return bounds.left >= row.left && bounds.right <= row.right;
          },
        ),
        markers: host.querySelectorAll("[data-reorder-drop]").length,
      };
    },
    close() {
      root.unmount();
      host.remove();
    },
  };
};

window.verifyCameraMirror = async () => {
  const saved = localStorage.getItem("lc.cameraMirror");
  localStorage.setItem("lc.cameraMirror", "false");
  const source = document.createElement("canvas");
  source.width = 96;
  source.height = 48;
  const paint = () => {
    const context = source.getContext("2d");
    context.fillStyle = "red";
    context.fillRect(0, 0, 48, 48);
    context.fillStyle = "blue";
    context.fillRect(48, 0, 48, 48);
  };
  paint();
  const raw = source.captureStream(30),
    timer = setInterval(paint, 30);
  const processor = new CameraMirrorProcessor();
  const sender = new RTCPeerConnection(),
    receiver = new RTCPeerConnection();
  const remote = document.createElement("video");
  remote.muted = true;
  remote.playsInline = true;
  document.body.append(remote);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const pending = [];
  sender.onicecandidate = ({ candidate }) => {
    if (candidate) {
      if (receiver.remoteDescription) void receiver.addIceCandidate(candidate);
      else pending.push([receiver, candidate]);
    }
  };
  receiver.onicecandidate = ({ candidate }) => {
    if (candidate) {
      if (sender.remoteDescription) void sender.addIceCandidate(candidate);
      else pending.push([sender, candidate]);
    }
  };
  receiver.ontrack = ({ track }) => {
    remote.srcObject = new MediaStream([track]);
    void remote.play();
  };
  try {
    await processor.init({ kind: "video", track: raw.getVideoTracks()[0] });
    const output = processor.processedTrack;
    sender.addTrack(output, new MediaStream([output]));
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(receiver.localDescription);
    for (const [peer, candidate] of pending)
      await peer.addIceCandidate(candidate);
    const probe = document.createElement("canvas");
    probe.width = 96;
    probe.height = 48;
    const pixels = () => {
      if (remote.readyState < 2) return [];
      const ctx = probe.getContext("2d");
      ctx.drawImage(remote, 0, 0, 96, 48);
      return Array.from(ctx.getImageData(24, 24, 1, 1).data);
    };
    const waitForColor = async (mirrored) => {
      for (let i = 0; i < 150; i++) {
        const p = pixels();
        if (mirrored ? p[2] > 180 && p[0] < 60 : p[0] > 180 && p[2] < 60)
          return;
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw new Error(
        `Remote camera did not become ${mirrored ? "mirrored" : "unmirrored"}`,
      );
    };
    await waitForColor(false);
    flushSync(() => root.render(h(CameraMirrorControl)));
    const control = host.querySelector(
      '.cameraMirrorControl input[type="checkbox"]',
    );
    check(
      control && !control.checked && control.getAttribute("role") === "switch",
      "Mirror camera uses the shared unchecked on/off control",
    );
    check(
      control.closest("label").getBoundingClientRect().height >= 44,
      "Switch rows provide a 44px click target",
    );
    control.closest("label").click();
    await waitForColor(true);
    check(
      source.getContext("2d").getImageData(24, 24, 1, 1).data[0] === 255,
      "Only the outgoing camera is transformed",
    );
    control.click();
    await waitForColor(false);
    const oldMode = localStorage.getItem("lc.microphoneMode"),
      oldEcho = localStorage.getItem("lc.echoCancellation");
    try {
      localStorage.setItem("lc.microphoneMode", "raw");
      localStorage.setItem("lc.echoCancellation", "on");
      flushSync(() => root.render(h(EchoCancellationToggle)));
      let echo = host.querySelector('input[role="switch"]');
      check(
        echo.disabled && !echo.checked,
        "Raw mode disables echo cancellation without changing the saved setting",
      );
      echo.closest("label").click();
      check(
        localStorage.getItem("lc.echoCancellation") === "on",
        "Clicking a disabled switch row does not persist a change",
      );
      localStorage.setItem("lc.microphoneMode", "browser");
      window.dispatchEvent(new Event("lc-microphone-processing-change"));
      await wait();
      echo = host.querySelector('input[role="switch"]');
      check(
        !echo.disabled && echo.checked,
        "Leaving Raw mode restores the saved echo preference",
      );
      echo.closest("label").click();
      await wait();
      check(
        localStorage.getItem("lc.echoCancellation") === "off" && !echo.checked,
        "Echo switch changes apply immediately through the row label",
      );
    } finally {
      for (const [key, value] of [
        ["lc.microphoneMode", oldMode],
        ["lc.echoCancellation", oldEcho],
      ]) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      window.dispatchEvent(new Event("lc-microphone-processing-change"));
    }
    flushSync(() =>
      root.render(
        h(
          "button",
          { className: "friendRow" },
          h(StatusAvatar, { name: "Friend", status: "online" }),
          h(
            "span",
            { className: "friendConversationLink" },
            h("b", null, "Friend"),
            h("small", null, "Online"),
          ),
        ),
      ),
    );
    const avatarBounds = host
      .querySelector(".statusAvatar")
      .getBoundingClientRect();
    const identityBounds = host
      .querySelector(".friendConversationLink")
      .getBoundingClientRect();
    check(
      avatarBounds.width === 36 &&
        identityBounds.left >= avatarBounds.right &&
        identityBounds.left - avatarBounds.right <= 16,
      "Friend profile information sits next to its fixed-size avatar",
    );
    await processor.destroy();
    check(
      output.readyState === "ended" &&
        raw.getVideoTracks()[0].readyState === "live",
      "Processor releases its output while leaving the SDK-owned source to its owner",
    );
    return {
      remotePixelMirroring: true,
      liveToggle: true,
      styledControl: true,
      cleanup: true,
    };
  } finally {
    root.unmount();
    host.remove();
    remote.srcObject = null;
    remote.remove();
    sender.close();
    receiver.close();
    clearInterval(timer);
    await processor.destroy();
    raw.getTracks().forEach((track) => track.stop());
    if (saved === null) localStorage.removeItem("lc.cameraMirror");
    else localStorage.setItem("lc.cameraMirror", saved);
  }
};

window.verifyMessageComposer = async () => {
  const container = document.createElement("section");
  container.className = "chat";
  container.style.cssText =
    "position:fixed;inset:20px;z-index:10000;display:block";
  document.body.append(container);
  const root = createRoot(container);
  let setText, setSending;
  let submitted = 0;
  function Fixture() {
    const [value, onChange] = useState("");
    const [files, onFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
      setText = onChange;
      setSending = setBusy;
    }, [onChange]);
    return h(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          submitted++;
        },
      },
      h(MessageComposer, {
        value,
        onChange,
        files,
        onFiles,
        placeholder: "Message test",
        busy,
        progress: null,
      }),
      h("button", { type: "submit" }, "Send"),
    );
  }
  try {
    flushSync(() => root.render(h(Fixture)));
    const textarea = container.querySelector("textarea");
    const height = () => textarea.getBoundingClientRect().height;
    const initial = height();
    for (const [value, lines] of [
      ["one\ntwo", 2],
      ["one\ntwo\nthree", 3],
      ["one\ntwo\nthree\nfour", 3],
      ["one\ntwo", 2],
      ["", 1],
    ]) {
      flushSync(() => setText(value));
      check(
        Math.abs(height() - (initial + 20 * (lines - 1))) < 1,
        `Composer did not resize to ${lines} rows`,
      );
      check(
        getComputedStyle(textarea).overflowY ===
          (value.includes("four") ? "auto" : "hidden"),
        "Composer scrolling does not match overflow",
      );
    }
    flushSync(() => setText("long text ".repeat(180)));
    check(
      height() === initial + 40 &&
        textarea.scrollHeight > textarea.clientHeight,
      "Wrapped text did not cap at three rows",
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
      }),
    );
    check(submitted === 0, "Shift+Enter submitted a message");
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    check(submitted === 1, "Enter did not submit a message");
    textarea.focus();
    flushSync(() => setSending(true));
    check(
      document.activeElement === textarea &&
        textarea.readOnly &&
        !textarea.disabled,
      "Sending retains chat focus while preventing draft edits",
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    check(submitted === 1, "Enter cannot resubmit while a message is sending");
    flushSync(() => {
      setText("");
      setSending(false);
    });
    check(
      document.activeElement === textarea && !textarea.readOnly,
      "The composer is ready for the next message after sending",
    );
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["%PDF-1.7"], "dropped.pdf", { type: "application/pdf" }),
    );
    container.querySelector(".messageComposer").dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    await wait();
    check(
      container
        .querySelector(".pendingAttachments")
        ?.textContent.includes("dropped.pdf"),
      "Dropped attachment was not staged",
    );
    container.querySelector('[aria-label="Remove dropped.pdf"]').click();
    await wait();
    check(
      !container.querySelector(".pendingAttachments"),
      "Attachment removal failed",
    );
    const picker = container.querySelector('input[type="file"]');
    picker.files = transfer.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    check(
      container
        .querySelector(".pendingAttachments")
        ?.textContent.includes("dropped.pdf"),
      "File picker did not stage attachment",
    );
    const picture = new DataTransfer();
    picture.items.add(
      new File(
        [
          Uint8Array.from(
            atob(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
            ),
            (char) => char.charCodeAt(0),
          ),
        ],
        "preview.png",
        { type: "image/png" },
      ),
    );
    const screenshotFile = picture.files[0];
    picker.files = picture.files;
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
    const preview = container.querySelector(".pendingImage");
    check(
      preview?.src.startsWith("blob:") &&
        preview.complete &&
        preview.naturalWidth === 1,
      "Selected image did not show a local thumbnail before sending",
    );
    const previewButton = container.querySelector(".pendingImageButton");
    const submittedBeforePreview = submitted;
    previewButton.focus();
    previewButton.click();
    await wait();
    const previewDialog = document.querySelector(".attachmentPreviewModal");
    check(
      previewDialog?.open &&
        previewDialog.querySelector("img").src === preview.src &&
        submitted === submittedBeforePreview,
      "Draft thumbnails open the local image in a window without submitting",
    );
    previewDialog.querySelector('[aria-label="Close image preview"]').click();
    await wait();
    check(
      !document.querySelector(".attachmentPreviewModal") &&
        document.activeElement === previewButton,
      "Closing a draft preview restores focus to its thumbnail",
    );
    const sentBeforePaste = submitted;
    const clipboardPicture = new DataTransfer();
    clipboardPicture.items.add(screenshotFile);
    const paste = new ClipboardEvent("paste", {
      clipboardData: clipboardPicture,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(paste);
    await wait();
    check(
      paste.defaultPrevented &&
        container.querySelectorAll(".pendingImage").length === 2 &&
        submitted === sentBeforePaste,
      "Pasted screenshots stage previews without automatically sending",
    );
    const textClipboard = new DataTransfer();
    textClipboard.setData("text/plain", "Ordinary pasted text");
    const textPaste = new ClipboardEvent("paste", {
      clipboardData: textClipboard,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(textPaste);
    check(
      !textPaste.defaultPrevented,
      "Ordinary text paste keeps browser behavior",
    );
    container.querySelector(".pendingImageButton").click();
    await wait();
    container.querySelector('[aria-label="Remove preview.png"]').click();
    await wait();
    check(
      !document.querySelector(".attachmentPreviewModal"),
      "Removing the selected draft image closes its preview window",
    );
    container.querySelector('[aria-label="Remove preview.png"]').click();
    await wait();
    check(
      !container.querySelector(".pendingImage"),
      "Removing an image left its preview behind",
    );
    flushSync(() => setText("ab"));
    const emojiButton = container.querySelector('[aria-label="Add emoji"]');
    const emojiBounds = emojiButton.getBoundingClientRect(),
      iconBounds = emojiButton.querySelector("svg").getBoundingClientRect(),
      sendBounds = container
        .querySelector('button[type="submit"]')
        .getBoundingClientRect();
    check(
      Math.abs(
        (emojiBounds.left + emojiBounds.right) / 2 -
          (iconBounds.left + iconBounds.right) / 2,
      ) < 1 &&
        Math.abs(
          (emojiBounds.top + emojiBounds.bottom) / 2 -
            (iconBounds.top + iconBounds.bottom) / 2,
        ) < 1,
      "Composer emoji SVG must be centered",
    );
    check(
      emojiBounds.left > textarea.getBoundingClientRect().right &&
        emojiBounds.right <= sendBounds.left + 1,
      "Composer emoji button sits between the textarea and Send",
    );
    textarea.focus();
    textarea.setSelectionRange(1, 1);
    container.querySelector('[aria-label="Add emoji"]').click();
    await wait();
    const emojiSearch = document.querySelector('[aria-label="Search emojis"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(emojiSearch, "blue heart");
    emojiSearch.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    document.querySelector('[aria-label="💙 blue heart"]').click();
    await wait();
    check(
      textarea.value === "a💙b" && textarea.selectionStart === 3,
      "Emoji insertion must preserve the caret and surrounding text",
    );
    check(
      !document.querySelector(".emojiPopover"),
      "Choosing an emoji closes the picker",
    );
    await verifyEmojiReactions();
    await verifyConversationDrafts();
    await verifyParticipantControls();
    await verifyParticipantIndicators();
    await verifyNativeAudioTransmission();
    await verifyProfilePictures();
    await verifyTypingIndicators();
    return {
      growShrink: true,
      emojiInsertion: true,
      reactions: true,
      liveReactionUpdates: true,
      typingIndicators: true,
      conversationDrafts: true,
      participantPlayback: true,
      profilePictures: true,
      wrappedText: true,
      threeRowScroll: true,
      enter: true,
      drop: true,
      picker: true,
      remove: true,
      pendingImagePreview: true,
    };
  } finally {
    root.unmount();
    container.remove();
  }
};

async function verifyTypingIndicators() {
  const host = document.createElement("section");
  host.className = "chat";
  host.style.cssText = "position:fixed;inset:20px;z-index:10001";
  document.body.append(host);
  const root = createRoot(host),
    sent = [];
  const connection = {
    readyState: 1,
    send: (value) => sent.push(JSON.parse(value)),
  };
  const originalTimeout = window.setTimeout;
  window.setTimeout = (callback, delay, ...args) =>
    originalTimeout(callback, delay === 7000 ? 250 : delay, ...args);
  function Fixture({ direct, target }) {
    const ref = React.useRef(connection);
    const [text, setText] = useState("");
    const typing = useTyping(
      ref,
      "viewer",
      direct ? { userId: target } : { channelId: target },
    );
    return h(
      "div",
      null,
      h("div", { className: "typingIndicator", role: "status" }, typing.label),
      h(
        "form",
        { onSubmit: (event) => event.preventDefault() },
        h(MessageComposer, {
          value: text,
          onChange: setText,
          onTyping: typing.change,
          files: [],
          onFiles() {},
          placeholder: "Typing test",
          progress: null,
        }),
        h("button", { type: "submit" }, "Send"),
      ),
    );
  }
  function input(value) {
    const textarea = host.querySelector("textarea");
    textarea.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  try {
    for (const direct of [false, true]) {
      root.render(
        h(Fixture, { direct, target: "conversation", key: String(direct) }),
      );
      await wait();
      sent.length = 0;
      input("Private draft");
      input("Private draft continues");
      await wait();
      check(
        sent.length === 1 &&
          sent[0].active === true &&
          !JSON.stringify(sent).includes("Private"),
        "Typing is throttled and never sends draft text",
      );
      const scope = direct
        ? { userId: "conversation" }
        : { channelId: "conversation" };
      window.dispatchEvent(
        new CustomEvent("lc-typing", {
          detail: {
            ...scope,
            users: [
              { id: "other", name: "Alice" },
              { id: "viewer", name: "Me" },
            ],
          },
        }),
      );
      await wait();
      check(
        host.querySelector(".typingIndicator").textContent ===
          "Alice is typing…",
        "Typing indicator shows the other person and excludes yourself",
      );
      await new Promise((resolve) => originalTimeout(resolve, 300));
      check(
        host.querySelector(".typingIndicator").textContent === "",
        "Typing expires without a stop packet",
      );
      const typingTextarea = host.querySelector("textarea");
      typingTextarea.focus();
      typingTextarea.blur();
      await wait();
      check(sent.at(-1).active === false, "Blur immediately stops typing");
      input("More draft");
      await wait();
      root.render(
        h(Fixture, {
          direct,
          target: "next-conversation",
          key: String(direct),
        }),
      );
      await wait();
      check(
        sent.at(-1).active === false &&
          (sent.at(-1).channelId ?? sent.at(-1).userId) === "conversation",
        "Navigation stops the old conversation without restoring a call",
      );
    }
  } finally {
    root.unmount();
    host.remove();
    window.setTimeout = originalTimeout;
  }
}

async function verifyProfilePictures() {
  const host = document.createElement("div"),
    originalFetch = window.fetch;
  document.body.append(host);
  const root = createRoot(host),
    requests = [];
  window.fetch = async (url, options) => {
    check(
      url === "/api/users/me/avatar",
      "Profile picture uses its authenticated self endpoint",
    );
    requests.push(options);
    return Response.json({
      image: options.method === "PUT" ? "/api/users/test/avatar?v=new" : null,
    });
  };
  function Fixture() {
    const [image, setImage] = useState("/old-picture");
    return h(
      SettingsModal,
      {
        title: "User settings",
        onClose() {},
        navigation: h(SettingsNavigation, {
          account: true,
          selected: "account",
          onSelect() {},
        }),
      },
      h(ProfilePictureSettings, {
        image,
        onSaved: async (next) => setImage(next),
      }),
    );
  }
  async function choose(file) {
    const input = document.querySelector(
      '[aria-label="Choose profile picture"]',
    );
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const until = performance.now() + 3000;
    do {
      await wait();
    } while (
      document.querySelector(".profileCropModal button.primary")?.disabled &&
      performance.now() < until
    );
  }
  try {
    flushSync(() => root.render(h(Fixture)));
    const navigation = document.querySelector(".settingsNavigation");
    for (const button of navigation.querySelectorAll("button"))
      if (["Delete account", "Log out"].includes(button.textContent))
        check(
          getComputedStyle(button).borderTopColor === "rgba(0, 0, 0, 0)",
          "Destructive settings navigation has no visible border",
        );
    const canvas = document.createElement("canvas");
    canvas.width = 500;
    canvas.height = 300;
    canvas.getContext("2d").fillRect(0, 0, 500, 300);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    await choose(new File([blob], "profile.png", { type: "image/png" }));
    check(
      requests.length === 0,
      "Choosing a picture waits for crop confirmation",
    );
    const preview = document.querySelector(
      '[aria-label="New profile picture preview"]',
    );
    check(
      preview && getComputedStyle(preview).borderRadius === "50%",
      "Crop editor shows the circular result before saving",
    );
    const zoom = document.querySelector('[aria-label="Zoom"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(zoom, "2");
    zoom.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    check(zoom.value === "2", "User controls the crop zoom");
    document.querySelector(".profileCropModal button.primary").click();
    const until = performance.now() + 3000;
    while (
      document.querySelector(".profileCropModal") &&
      performance.now() < until
    )
      await wait();
    check(
      requests.length === 1 &&
        requests[0].method === "PUT" &&
        requests[0].body.type === "image/png",
      "Picture picker uploads a prepared PNG",
    );
    const image = await createImageBitmap(requests[0].body);
    check(
      image.width === 256 && image.height === 256,
      "Profile picture preparation saves the selected square crop",
    );
    image.close();
    check(
      document.querySelector('[role="status"]')?.textContent ===
        "Profile picture changed.",
      "Picture change shows success after saving",
    );
    await choose(new File([blob], "cancel.png", { type: "image/png" }));
    [...document.querySelectorAll(".profileCropModal button")]
      .find((button) => button.textContent === "Cancel")
      .click();
    await wait();
    check(
      requests.length === 1 && !document.querySelector(".profileCropModal"),
      "Cancelling a crop preserves the current picture without uploading",
    );
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Remove picture")
      .click();
    await wait();
    check(
      requests.at(-1).method === "DELETE" &&
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent === "Remove picture",
        ).disabled,
      "Picture can be removed from My account",
    );
    const count = requests.length;
    await choose(
      new File(["<svg/>"], "not-allowed.svg", { type: "image/svg+xml" }),
    );
    check(
      requests.length === count && document.querySelector('[role="alert"]'),
      "Unsupported profile pictures are rejected before upload",
    );
  } finally {
    root.unmount();
    host.remove();
    window.fetch = originalFetch;
  }
}

async function verifyParticipantControls() {
  const voiceDelay = () => new Promise((resolve) => setTimeout(resolve, 800));
  await voiceDelay();
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;top:20px;left:20px;width:260px";
  document.body.append(host);
  const root = createRoot(host);
  let settings;
  const image =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="blue"/></svg>',
    );
  function Fixture({ account = "owner", person = "alice" }) {
    const playback = useParticipantAudio(account);
    React.useLayoutEffect(() => {
      settings = playback;
    });
    return h(
      "div",
      null,
      h(Avatar, { name: "Alice", image }),
      h(Avatar, { name: "Alice", small: true }),
      h(LocallyMuted, {
        muted: playback.values[person]?.muted,
        deafened: playback.values[person]?.deafened,
      }),
      h(ParticipantAudioControls, {
        value: playback.values[person],
        onChange: (patch) => playback.change(person, patch),
      }),
    );
  }
  const visit = (person = "alice", account = "owner") =>
    flushSync(() => root.render(h(Fixture, { account, person })));
  try {
    visit();
    await Promise.race([
      host.querySelector("img").decode(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Avatar decode timed out")), 3000),
      ),
    ]);
    const avatars = host.querySelectorAll(".userAvatar");
    check(
      getComputedStyle(avatars[0]).borderRadius === "50%" &&
        avatars[1].clientWidth < avatars[0].clientWidth,
      "Profile pictures are circular with smaller voice-channel avatars",
    );
    host.querySelector("img").dispatchEvent(new Event("error"));
    await wait();
    check(
      !host.querySelector("img") && avatars[0].textContent === "A",
      "Failed profile images fall back to initials",
    );
    const slider = host.querySelector("input");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(slider, "35");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    check(
      settings.values.alice.volume === 35,
      "Person volume changes independently",
    );
    const personalButtons = [
      ...host.querySelectorAll(".participantAudioActions > button"),
    ];
    check(
      personalButtons.length === 2 &&
        Math.abs(
          personalButtons[0].getBoundingClientRect().top -
            personalButtons[1].getBoundingClientRect().top,
        ) < 1 &&
        personalButtons.every(
          (button) => getComputedStyle(button).textAlign === "center",
        ),
      "Personal mute/deafen controls are centered side by side",
    );
    host.querySelector("button").click();
    await wait();
    check(
      settings.values.alice.muted && settings.values.alice.volume === 35,
      "Muting preserves the selected person volume",
    );
    check(
      host.querySelector('[aria-label="Muted for you"]'),
      "Local mute displays its status icon",
    );
    host.querySelector("button").click();
    await wait();
    check(
      settings.values.alice.muted,
      "Rapid mute toggles are ignored during the cooldown",
    );
    visit("bob");
    check(
      host.querySelector("input").value === "100" &&
        host.querySelector('[aria-checked="false"]'),
      "Other people keep their own volume and mute state",
    );
    visit();
    check(
      host.querySelector("input").value === "35" &&
        host.querySelector('[aria-checked="true"]'),
      "Person settings survive navigation",
    );
    await voiceDelay();
    host.querySelector("button").click();
    await wait();
    check(
      !settings.values.alice.muted && settings.values.alice.volume === 35,
      "Unmute restores the chosen volume",
    );
    check(
      !host.querySelector('[aria-label="Muted for you"]'),
      "Unmuting removes the status icon",
    );
    await voiceDelay();
    host.querySelectorAll("button")[1].click();
    await wait();
    check(
      settings.values.alice.deafened &&
        !settings.values.alice.muted &&
        host.querySelector('[aria-label="Deafened between you"]'),
      "Personal deafen is separate from mute and displays the headphones icon",
    );
    await voiceDelay();
    host.querySelectorAll("button")[1].click();
    await wait();
    visit("alice", "someone-else");
    check(
      host.querySelector("input").value === "100",
      "Playback settings cannot leak across accounts",
    );
    flushSync(() =>
      root.render(
        h(VoiceParticipantMenu, {
          x: 20,
          y: 20,
          channels: [],
          canModerate: false,
          audio: { volume: 35, muted: true },
          onAudioChange() {},
          onClose() {},
          onKick() {},
          onMove() {},
        }),
      ),
    );
    check(
      host.querySelector('[aria-label="Person volume"]') &&
        ![...host.querySelectorAll("button")].some(
          (button) =>
            button.textContent === "Kick" ||
            button.textContent.includes("Move") ||
            button.textContent.includes("Server mute") ||
            button.textContent.includes("Server deafen"),
        ),
      "Non-owners can adjust local playback without moderation actions",
    );
    await voiceDelay();
    const changes = [];
    flushSync(() =>
      root.render(
        h(VoiceParticipantMenu, {
          x: 20,
          y: 20,
          channels: [],
          canModerate: true,
          onClose() {},
          onKick() {},
          onMove() {},
          onServerChange: async (patch) => {
            changes.push(patch);
          },
        }),
      ),
    );
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Server mute"))
      .click();
    await voiceDelay();
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent.includes("Server deafen"))
      .click();
    await wait();
    check(
      changes.length === 2 && changes[0].voiceMuted && changes[1].voiceDeafened,
      "Owner-only server controls send distinct mute and deafen changes",
    );
    await voiceDelay();
    flushSync(() =>
      root.render(
        h(VoiceParticipantMenu, {
          x: 20,
          y: 20,
          channels: [],
          canModerate: true,
          serverPolicy: { voiceMuted: true, voiceDeafened: true },
          onClose() {},
          onKick() {},
          onMove() {},
          onServerChange: async (patch) => {
            changes.push(patch);
          },
        }),
      ),
    );
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Server unmute")
      .click();
    await voiceDelay();
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Server undeafen")
      .click();
    await wait();
    check(
      changes[2].voiceMuted === false && changes[3].voiceDeafened === false,
      "Active server restrictions expose explicit unmute and undeafen actions",
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

async function verifyNativeAudioTransmission() {
  // Generated media has no speaker connection; this browser check is silent.
  const context = new AudioContext(),
    source = context.createOscillator(),
    destination = context.createMediaStreamDestination();
  const sender = new RTCPeerConnection(),
    receiver = new RTCPeerConnection();
  const candidates = [];
  sender.onicecandidate = (event) => {
    if (event.candidate) candidates.push([receiver, event.candidate]);
  };
  receiver.onicecandidate = (event) => {
    if (event.candidate) candidates.push([sender, event.candidate]);
  };
  source.connect(destination);
  source.start();
  const track = destination.stream.getAudioTracks()[0];
  sender.addTrack(track, destination.stream);
  const errors = [],
    gate = createAudioTransmissionGate(sender, () => errors.push("failed"));
  try {
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(receiver.localDescription);
    const until = performance.now() + 8000;
    while (
      sender.connectionState !== "connected" &&
      performance.now() < until
    ) {
      for (const [peer, candidate] of candidates.splice(0))
        await peer.addIceCandidate(candidate);
      await wait();
    }
    check(
      sender.connectionState === "connected",
      "Audio transmission test negotiates a real browser peer connection",
    );
    await gate.update(true);
    check(
      sender
        .getSenders()[0]
        .getParameters()
        .encodings.every((encoding) => !encoding.active) &&
        track.enabled &&
        !errors.length,
      "Personal deafen blocks native outgoing audio without stopping shared capture",
    );
    await gate.update(false);
    check(
      sender
        .getSenders()[0]
        .getParameters()
        .encodings.every((encoding) => encoding.active) && !errors.length,
      "Undeafen restores the native sender without renegotiating",
    );
  } finally {
    sender.close();
    receiver.close();
    source.stop();
    track.stop();
    await context.close();
  }
}

async function verifyConversationDrafts() {
  const host = document.createElement("div");
  host.className = "chat";
  host.style.cssText = "position:fixed;top:20px;left:20px;width:300px";
  document.body.append(host);
  let root = createRoot(host),
    current;
  function Fixture({ account, conversation }) {
    const draft = useConversationDraft(account, conversation);
    React.useLayoutEffect(() => {
      current = draft;
    });
    return h(MessageComposer, {
      value: draft.text,
      onChange: draft.setText,
      files: draft.files,
      onFiles: draft.setFiles,
      placeholder: "Draft",
      progress: null,
    });
  }
  const visit = (conversation, account = "draft-owner") =>
    flushSync(() => root.render(h(Fixture, { account, conversation })));
  const write = (text) => flushSync(() => current.setText(text));
  const file = new File(["pdf"], "draft.pdf", { type: "application/pdf" });
  try {
    visit("channel:server-one-general");
    write("First channel draft");
    flushSync(() => current.setFiles([file]));
    const sent = current.clearSent;
    visit("channel:server-one-other");
    check(
      current.text === "" && !current.files.length,
      "New channel starts with an empty draft",
    );
    write("Second channel draft");
    visit("channel:server-two-general");
    write("Other server draft");
    visit("direct:friend-one");
    write("Private draft");
    visit("direct:friend-two");
    check(current.text === "", "Direct conversations have separate drafts");
    write("Another private draft");
    visit("channel:server-one-general");
    check(
      host.querySelector("textarea").value === "First channel draft" &&
        current.files[0] === file,
      "Channel text and selected files survive server/DM navigation",
    );
    write("A newer draft while the old send finishes");
    flushSync(sent);
    check(
      current.text === "A newer draft while the old send finishes",
      "An old successful send cannot clear a newer draft",
    );
    const finish = current.clearSent;
    visit("direct:friend-one");
    flushSync(finish);
    check(
      current.text === "Private draft",
      "Send completion cannot clear the currently viewed conversation",
    );
    visit("channel:server-one-general");
    check(
      current.text === "" && !current.files.length,
      "A successful send clears its original text and attachments even after navigation",
    );
    visit("channel:server-one-other");
    check(
      current.text === "Second channel draft",
      "Other pending drafts remain intact",
    );
    visit("channel:server-two-general");
    check(
      current.text === "Other server draft",
      "Drafts remain isolated across servers",
    );
    visit("direct:friend-two");
    check(
      current.text === "Another private draft",
      "Second DM retains its own draft",
    );
    visit("direct:friend-two", "other-account");
    check(
      current.text === "" && !current.files.length,
      "Drafts cannot leak between accounts",
    );
    visit("direct:friend-two");
    check(
      current.text === "",
      "Switching accounts clears the previous session's drafts",
    );
    write("Ephemeral draft");
    root.unmount();
    root = createRoot(host);
    visit("direct:friend-two");
    check(
      current.text === "" && !current.files.length,
      "Remount/reload starts without saved drafts",
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

async function verifyEmojiReactions() {
  const originalFetch = window.fetch,
    host = document.createElement("div");
  host.className = "chatLog";
  host.style.cssText =
    "position:fixed;top:20px;left:20px;width:300px;height:100px;overflow:auto;display:block;scroll-behavior:auto";
  document.body.append(host);
  const root = createRoot(host);
  const messageId = "11111111-1111-4111-8111-111111111111",
    target = "22222222-2222-4222-8222-222222222222";
  let count = 0,
    mine = false,
    deferReads = false;
  const delayed = [];
  const viewerAccount = `viewer-${Date.now()}-${Math.random()}`;
  let deferDetails = false;
  const pendingDetails = [];
  const detailResponse = () =>
    Response.json({
      people: Array.from({ length: count }, (_, index) => ({
        userId: `reactor-${index}`,
        name: `Reactor ${index}`,
        emoji: "👍",
        me: mine && index === 0,
      })),
    });
  window.fetch = async (url, options = {}) => {
    check(
      String(url).startsWith("/api/message-reactions"),
      "Reactions use their dedicated API",
    );
    if (
      !options.method &&
      new URL(url, "https://lc.test").searchParams.get("details") === "1"
    ) {
      return deferDetails
        ? new Promise((resolve) => pendingDetails.push(resolve))
        : detailResponse();
    }
    if (!options.method)
      return deferReads
        ? new Promise((resolve) => delayed.push(resolve))
        : Response.json({
            [messageId]: count ? [{ emoji: "👍", count, me: mine }] : [],
          });
    const body = JSON.parse(options.body);
    check(
      body.emoji === "👍" && body.messageId === messageId,
      "Reaction mutation sends the selected emoji and message",
    );
    if (options.method === "DELETE") {
      mine = false;
      count--;
    } else {
      if (!mine) count++;
      mine = true;
    }
    return Response.json({ ok: true });
  };
  function Fixture({ direct, accountId = viewerAccount }) {
    const [menu, setMenu] = useState(false);
    const scope = direct ? { userId: target } : { channelId: target };
    const reactions = useMessageReactions(accountId, scope, [messageId]);
    const props = {
      accountId,
      messageId,
      ...scope,
      reactions: reactions.data[messageId],
      onRefresh: reactions.refresh,
    };
    return h(
      "article",
      {
        "data-message-id": messageId,
        style: { paddingTop: "60px", paddingBottom: "12px" },
        onContextMenu: (event) => {
          event.preventDefault();
          setMenu(true);
        },
      },
      h("p", null, "React to this message"),
      h(MessageReactions, props),
      menu &&
        h(
          "div",
          {
            className: "messageContextMenu",
            role: "menu",
            style: {
              position: "fixed",
              left: "10px",
              top: "20px",
              width: "180px",
            },
          },
          h(MessageReactionMenu, { ...props, onDone: () => setMenu(false) }),
        ),
    );
  }
  try {
    for (const direct of [false, true]) {
      count = 0;
      mine = false;
      root.render(h(Fixture, { direct, key: String(direct) }));
      await wait();
      host.scrollTop = host.scrollHeight;
      const pageScroll = window.scrollY;
      check(
        !host.querySelector(".emojiTrigger"),
        "Messages have no permanent emoji button",
      );
      host
        .querySelector("article")
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      await wait();
      const reactTrigger = host.querySelector(
        '[role="menuitem"][aria-label="React"]',
      );
      if (direct) reactTrigger.click();
      else
        reactTrigger.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
          }),
        );
      await wait();
      const bounds = document
        .querySelector(".emojiPopover")
        .getBoundingClientRect();
      check(
        bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0,
        "Emoji picker stays inside the viewport",
      );
      const triggerBounds = reactTrigger.getBoundingClientRect();
      const arrowBounds = reactTrigger
        .querySelector("svg")
        .getBoundingClientRect();
      check(
        Math.abs(
          (arrowBounds.top +
            arrowBounds.bottom -
            triggerBounds.top -
            triggerBounds.bottom) /
            2,
        ) < 1,
        "React submenu arrow is vertically centered",
      );
      if (innerWidth > 600)
        check(
          bounds.left >= triggerBounds.right,
          "Hover picker opens to the right when space permits",
        );
      if (!direct) {
        const panel = document.querySelector(".emojiPopover");
        reactTrigger.dispatchEvent(
          new PointerEvent("pointerout", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: panel,
          }),
        );
        panel.dispatchEvent(
          new PointerEvent("pointerover", {
            bubbles: true,
            pointerType: "mouse",
            relatedTarget: reactTrigger,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 220));
        check(
          document.querySelector(".emojiPopover"),
          "Pointer can travel from React into its submenu",
        );
        reactTrigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        await wait();
        check(
          !document.querySelector(".emojiPopover"),
          "Escape closes the hover submenu",
        );
        reactTrigger.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
        await wait();
        check(
          document.activeElement?.getAttribute("aria-label") ===
            "Search emojis",
          "Arrow Right opens and focuses the submenu for keyboard use",
        );
      }
      document.querySelector('[aria-label="👍 thumbs up yes"]').click();
      await wait();
      check(
        host
          .querySelector('.reactionChip[aria-pressed="true"]')
          ?.textContent.includes("1"),
        "Own reaction appears with a count and selected state",
      );
      check(
        !host.querySelector(".reactionRemove"),
        "Reaction chips open details instead of displaying a removal X",
      );
      const messageBottom = host
        .querySelector("article")
        .getBoundingClientRect().bottom;
      const visibleBottom =
        host.getBoundingClientRect().top + host.clientTop + host.clientHeight;
      check(
        messageBottom <= visibleBottom + 1 && window.scrollY === pageScroll,
        "Growing reactions remain visible by scrolling only the chat pane",
      );
      check(
        !host.querySelector('[role="menu"]'),
        "Picking a reaction closes the message context menu",
      );
      count = 2;
      window.dispatchEvent(
        new CustomEvent("lc-message-reactions", { detail: { messageId } }),
      );
      await wait();
      check(
        host.querySelector(".reactionChip")?.textContent.includes("2"),
        "Another client's reaction updates the count",
      );
      deferReads = true;
      window.dispatchEvent(
        new CustomEvent("lc-message-reactions", { detail: { messageId } }),
      );
      window.dispatchEvent(
        new CustomEvent("lc-message-reactions", { detail: { messageId } }),
      );
      await wait();
      check(
        delayed.length === 2,
        "Both live invalidations request current counts",
      );
      count = 4;
      delayed[1](
        Response.json({ [messageId]: [{ emoji: "👍", count: 4, me: true }] }),
      );
      await wait();
      delayed[0](
        Response.json({ [messageId]: [{ emoji: "👍", count: 2, me: true }] }),
      );
      await wait();
      check(
        host.querySelector(".reactionChip")?.textContent.includes("4"),
        "Late reaction responses must not regress newer counts",
      );
      delayed.length = 0;
      deferReads = false;
      deferDetails = true;
      host.querySelector(".reactionChip").click();
      await wait();
      check(
        document.querySelectorAll(".messageReactionsModal .skeletonRow")
          .length === 3,
        "Uncached reaction details use the shared skeleton template",
      );
      deferDetails = false;
      pendingDetails.splice(0).forEach((resolve) => resolve(detailResponse()));
      await wait();
      const dialog = document.querySelector(".messageReactionsModal");
      check(
        dialog?.open &&
          dialog.querySelectorAll(".reactionPeople li").length === 4,
        "Clicking a chip shows everyone who reacted",
      );
      check(
        count === 4 && dialog.querySelectorAll(".reactionRemove").length === 1,
        "Opening details does not toggle reactions, and only your row has a removal X",
      );
      dialog.querySelector('[aria-label="Remove your reaction"]').click();
      await wait();
      check(
        host
          .querySelector('.reactionChip[aria-pressed="false"]')
          ?.textContent.includes("3"),
        "The X in reaction details removes only your own contribution",
      );
      check(
        dialog.querySelectorAll(".reactionPeople li").length === 3 &&
          !dialog.querySelector(".reactionRemove"),
        "Open reaction details update after removal",
      );
      dialog.querySelector('[aria-label="Close reactions"]').click();
      await wait();
      deferDetails = true;
      host.querySelector(".reactionChip").click();
      await wait();
      let reopened = document.querySelector(".messageReactionsModal");
      check(
        reopened.querySelectorAll(".reactionPeople li").length === 3 &&
          !reopened.querySelector(".loadingSkeleton"),
        "Reopening immediately displays cached participants while refresh is pending",
      );
      count = 2;
      deferDetails = false;
      pendingDetails.splice(0).forEach((resolve) => resolve(detailResponse()));
      await wait();
      check(
        reopened.querySelectorAll(".reactionPeople li").length === 2,
        "Background refresh updates cached details without a loading flash",
      );
      reopened.querySelector('[aria-label="Close reactions"]').click();
      await wait();
      root.render(
        h(Fixture, {
          direct,
          accountId: `${viewerAccount}-other`,
          key: `${direct}-other`,
        }),
      );
      await wait();
      deferDetails = true;
      host.querySelector(".reactionChip").click();
      await wait();
      reopened = document.querySelector(".messageReactionsModal");
      check(
        reopened.querySelector(".loadingSkeleton") &&
          !reopened.querySelector(".reactionPeople li"),
        "Switching accounts cannot display another account's cached participants",
      );
      deferDetails = false;
      pendingDetails.splice(0).forEach((resolve) => resolve(detailResponse()));
      await wait();
      reopened.querySelector('[aria-label="Close reactions"]').click();
      await wait();
    }
  } finally {
    root.unmount();
    host.remove();
    window.fetch = originalFetch;
  }
}
window.verifyAttachmentPreview = async () => {
  const container = document.createElement("section");
  container.className = "chat";
  container.style.cssText =
    "position:fixed;inset:20px;z-index:10000;display:block";
  document.body.append(container);
  const root = createRoot(container);
  const file = {
    id: "image-test",
    name: `A very long image filename ${"example ".repeat(30)}.png`,
    type: "image/png",
    size: 512000,
  };
  const pdf = {
    id: "pdf-test",
    name: "Report.pdf",
    type: "application/pdf",
    size: 1258291,
  };
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 800;
  const context = canvas.getContext("2d");
  context.fillStyle = "#78a4ff";
  context.fillRect(0, 0, 1200, 800);
  const render = (deleted = false, attachments = [file, pdf]) =>
    flushSync(() =>
      root.render(
        h(
          "article",
          { className: "messageOwn" },
          h(MessageAttachments, { files: attachments, deleted }),
        ),
      ),
    );
  const modal = () => document.querySelector(".attachmentPreviewModal");
  const open = async () => {
    const trigger = container.querySelector(".attachmentThumbnail");
    trigger.focus();
    trigger.click();
    await wait();
    check(modal()?.open, "Image click did not open an in-app modal");
    check(
      modal().getAttribute("aria-labelledby"),
      "Preview dialog has no accessible title",
    );
    return trigger;
  };
  try {
    render();
    check(
      container.querySelectorAll(".attachmentDownload").length === 1,
      "PDF retains its download icon while images have no file chrome",
    );
    check(
      container.querySelectorAll(".attachmentThumbnail").length === 1,
      "PDF must not open an image preview",
    );
    check(
      !container.querySelector('[target="_blank"]'),
      "Attachment opens a new tab",
    );
    const download = container.querySelector(".attachmentDownload");
    check(
      download.getAttribute("href") ===
        "/api/attachments/pdf-test?download=1" &&
        download.getAttribute("download") === pdf.name,
      "Download does not use authenticated endpoint/original filename",
    );
    check(
      download.getAttribute("aria-label") === `Download ${pdf.name}` &&
        download.querySelector("svg"),
      "Download icon needs an accessible label",
    );
    check(
      !container.textContent.includes(file.name) &&
        container.textContent.includes("1.2 MB"),
      "Attachment size formatting is wrong",
    );
    const name = container.querySelector(".attachmentDetails strong");
    check(
      getComputedStyle(name).textOverflow === "ellipsis",
      "Long filename is not truncated",
    );
    check(
      container.querySelector(".messageAttachment").scrollWidth <=
        container.querySelector(".messageAttachment").clientWidth,
      "Filename overflows attachment card",
    );
    const trigger = await open();
    const image = modal().querySelector(".attachmentPreviewStage img");
    image.src = canvas.toDataURL("image/png");
    await image.decode();
    await wait();
    check(
      !image.hidden &&
        modal()
          .querySelector(".attachmentPreviewStage")
          .getAttribute("aria-busy") === "false",
      "Decoded preview did not leave loading state",
    );
    check(
      modal().getBoundingClientRect().width <= innerWidth &&
        modal().scrollWidth <= modal().clientWidth,
      "Preview exceeds viewport width",
    );
    check(
      modal().getBoundingClientRect().height <= innerHeight,
      "Preview exceeds viewport height",
    );
    check(
      container.querySelector(".attachmentThumbnail") === trigger,
      "Opening a preview replaced the chat",
    );
    modal().querySelector('[aria-label="Close image preview"]').click();
    await wait();
    check(
      !modal() && document.activeElement === trigger,
      "Close did not restore thumbnail focus",
    );
    await open();
    modal()
      .querySelector(".attachmentPreviewStage img")
      .dispatchEvent(new Event("error"));
    await wait();
    check(
      modal()
        .querySelector('[role="alert"]')
        ?.textContent.includes("could not be loaded"),
      "Unavailable image has no error feedback",
    );
    modal().dispatchEvent(new Event("cancel", { cancelable: true }));
    await wait();
    check(!modal(), "Escape/cancel did not dismiss preview");
    await open();
    modal().dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: -1, clientY: -1 }),
    );
    await wait();
    check(!modal(), "Backdrop did not dismiss preview");
    await open();
    render(true);
    await wait();
    check(
      !modal() && !container.querySelector(".messageAttachments"),
      "Deleted message retained its preview",
    );
    const pictures = Array.from({ length: 12 }, (_, index) => ({
      ...file,
      id: `picture-${index}`,
      name: `Photo ${index}.png`,
    }));
    render(false, pictures);
    await wait();
    const overflow = container.querySelector(".attachmentOverflow");
    check(
      overflow &&
        container.querySelectorAll(".attachmentImageRow").length === 1,
      "Pictures share one row with an overflow tile",
    );
    const tiles = [
      ...container.querySelectorAll(".attachmentImageRow > button"),
    ];
    check(
      tiles.filter((tile) => !tile.classList.contains("attachmentOverflow"))
        .length <= 2,
      "Inline row contains at most two pictures plus its overflow tile",
    );
    check(
      getComputedStyle(tiles[0].querySelector("img")).objectFit === "contain",
      "Inline images retain their full uncropped content",
    );
    check(
      tiles.every(
        (tile) =>
          Math.abs(
            tile.getBoundingClientRect().top -
              tiles[0].getBoundingClientRect().top,
          ) < 1,
      ),
      "Inline pictures do not wrap into extra rows",
    );
    const overflowContext = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    overflow.dispatchEvent(overflowContext);
    await wait();
    check(
      overflowContext.defaultPrevented &&
        !document.querySelector(".imageDownloadMenu"),
      "Overflow placeholder has no download context menu",
    );
    overflow.click();
    await wait();
    const gallery = document.querySelector(".attachmentGalleryModal");
    const viewport = gallery.querySelector(".attachmentGalleryViewport");
    check(
      gallery.open &&
        gallery.querySelectorAll(".attachmentThumbnail").length === 12,
      "Overflow opens every picture in the gallery",
    );
    check(
      getComputedStyle(
        gallery.querySelector(".attachmentGalleryGrid"),
      ).gridTemplateColumns.split(" ").length === 3 &&
        viewport.scrollHeight > viewport.clientHeight,
      "Gallery uses three columns and vertical overflow after three rows",
    );
    const galleryImage = gallery.querySelector("img");
    const contextEvent = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    galleryImage.dispatchEvent(contextEvent);
    check(
      contextEvent.defaultPrevented,
      "Picture uses the app's explicit download context menu",
    );
    await wait();
    const downloadAction = gallery.querySelector(
      '.imageDownloadMenu [role="menuitem"]',
    );
    check(
      downloadAction?.textContent === "Download picture" &&
        downloadAction.getAttribute("href").endsWith("?download=1"),
      "Gallery menu offers authenticated picture download inside the modal",
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check(
      gallery.open && !gallery.querySelector(".imageDownloadMenu"),
      "Escape dismisses the download menu while retaining the gallery",
    );
    check(
      getComputedStyle(galleryImage).objectFit === "contain",
      "Gallery preserves whole pictures",
    );
    galleryImage.closest("button").click();
    await wait();
    check(
      modal()?.open && gallery.open,
      "Gallery pictures open the full preview without losing the gallery",
    );
    modal().querySelector('[aria-label="Close image preview"]').click();
    await wait();
    gallery.querySelector('[aria-label="Close pictures"]').click();
    await wait();
    return {
      fileDetails: true,
      separateDownload: true,
      inAppPreview: true,
      viewportBounds: true,
      focusRestored: true,
      errorFeedback: true,
      cancel: true,
      backdrop: true,
      deletion: true,
      imageGallery: true,
    };
  } finally {
    root.unmount();
    container.remove();
  }
};
window.verifyChatTools = async () => {
  await verifyPrivacyManagement();
  verifyWorkspaceHeaderLayout();
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;inset:0;z-index:10000";
  document.body.append(container);
  const root = createRoot(container),
    originalFetch = window.fetch;
  const searches = [],
    selected = [],
    legal = [];
  let help = 0,
    resolveSlow;
  const rows = Array.from({ length: 51 }, (_, index) => ({
    id: `message-${index + 1}`,
    authorId: "actor",
    author: "Actor",
    text: `Context ${index + 1}`,
    createdAt: "2026-11-04T12:00:00Z",
  }));
  window.fetch = async (url, options) => {
    if (!String(url).startsWith("/api/message-search"))
      return originalFetch(url, options);
    const params = new URL(url, "http://localhost").searchParams;
    searches.push(params);
    if (params.get("q") === "slow")
      return new Promise((resolve) => {
        resolveSlow = () =>
          resolve(Response.json({ messages: [rows[0]], nextCursor: null }));
      });
    if (params.get("contextId"))
      return Response.json({ messages: rows, nextCursor: null });
    return Response.json({
      messages: params.has("beforeId") ? [rows[10]] : [rows[25]],
      nextCursor: params.has("beforeId")
        ? null
        : { beforeId: "cursor", beforeCreatedAt: rows[0].createdAt },
    });
  };
  function Fixture() {
    const [editing, setEditing] = useState(false),
      [draft, setDraft] = useState("Unsent draft"),
      [editDraft, setEditDraft] = useState("Original message"),
      [saved, setSaved] = useState(null),
      [context, setContext] = useState(null),
      [section, setSection] = useState("account");
    const links = h(WorkspaceLinks, {
      onLegal: (value) => legal.push(value),
      onHelp: () => help++,
    });
    const visible = context
      ? rows
      : [{ ...rows[50], text: saved ?? "Original message" }];
    return h(
      "div",
      { className: "workspace" },
      h("aside", { className: "workspaceRail" }),
      h("aside", { className: "channelSidebar" }),
      h(
        "section",
        { className: "room" },
        h(
          "header",
          { className: "roomHeader" },
          h("strong", null, "General"),
          h(ConversationSearch, {
            channelId: "channel-test",
            onResult: (messages, target) => {
              selected.push(target);
              setContext({ messages, target });
            },
          }),
        ),
        h(
          "section",
          { className: "chat" },
          h(
            ChatHistory,
            {
              key: context ? "context" : "latest",
              threadId: context ? "context" : "latest",
              messages: visible,
              ready: true,
              hasMore: false,
              loadingOlder: false,
              onLoadOlder: async () => {},
              ownUserId: "actor",
              focusMessageId: context?.target,
              onJumpToPresent: context ? () => setContext(null) : undefined,
              contextNotice: context
                ? h(
                    "div",
                    { className: "searchContextNotice" },
                    h("span", null, "Viewing search context"),
                  )
                : null,
            },
            visible.map((row) =>
              h(
                "article",
                {
                  key: row.id,
                  "data-message-id": row.id,
                  "data-search-match": row.id === context?.target || undefined,
                  style: { minHeight: 65 },
                },
                h(MessageHeader, {
                  name: "Actor",
                  time: "12:00",
                  edited: !!saved,
                  onProfile() {},
                }),
                h("p", null, row.text),
              ),
            ),
          ),
          h(
            "form",
            {
              onSubmit: (event) => {
                event.preventDefault();
                if (editing) {
                  setSaved(editDraft);
                  setEditing(false);
                }
              },
            },
            h(MessageComposer, {
              value: editing ? editDraft : draft,
              onChange: editing ? setEditDraft : setDraft,
              files: [],
              onFiles() {},
              placeholder: "Message general",
              progress: null,
              editId: editing ? "edited-message" : undefined,
              onCancelEdit: () => setEditing(false),
            }),
            h(
              "button",
              { type: "submit", "data-chat-send": true },
              editing ? "Edit" : "Send",
            ),
          ),
          h(
            "button",
            {
              type: "button",
              "data-start-edit": true,
              onClick: () => setEditing(true),
            },
            "Edit message",
          ),
        ),
      ),
      h(
        "aside",
        { className: "memberSidebar" },
        h("div", { className: "memberScroll" }),
        links,
      ),
      h("div", { className: "compactWorkspaceLinks" }, links),
      h(
        "div",
        {
          className: "testOwnerNavigation",
          style: {
            position: "fixed",
            left: 0,
            top: 80,
            width: 180,
            display: "none",
          },
        },
        h(SettingsNavigation, {
          account: true,
          owner: true,
          selected: section,
          onSelect: setSection,
        }),
      ),
      h(
        "div",
        { className: "testMemberNavigation", style: { display: "none" } },
        h(SettingsNavigation, {
          account: true,
          owner: false,
          selected: "account",
          onSelect() {},
        }),
      ),
    );
  }
  const input = () => container.querySelector(".conversationSearch input");
  async function typeSearch(value) {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
  }
  try {
    flushSync(() => root.render(h(Fixture)));
    container.querySelector("[data-start-edit]").click();
    await wait();
    const textarea = container.querySelector("textarea");
    check(
      textarea.value === "Original message" &&
        document.activeElement === textarea,
      "Edit did not transfer text/focus into composer",
    );
    check(
      container.querySelector("[data-chat-send]").textContent === "Edit",
      "Edit button did not replace Send",
    );
    check(
      container.querySelector('[aria-label="Add attachment"]').disabled,
      "Editing allowed new attachments",
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check(
      textarea.value === "Unsent draft" &&
        container.querySelector("[data-chat-send]").textContent === "Send",
      "Escape did not restore the original draft",
    );
    container.querySelector("[data-start-edit]").click();
    await wait();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(textarea, "Corrected message");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    container.querySelector("[data-chat-send]").click();
    await wait();
    check(
      container.querySelector(".messageEdited")?.textContent === "(edited)" &&
        container
          .querySelector(".chatLog")
          .textContent.includes("Corrected message"),
      "Saved edit lacks text/edited label",
    );
    check(
      container
        .querySelector(".testOwnerNavigation")
        .textContent.includes("Admin dashboard") &&
        !container
          .querySelector(".testMemberNavigation")
          .textContent.includes("Admin dashboard"),
      "Admin dashboard navigation is not owner-only",
    );
    const helpButton = [...container.querySelectorAll(".helpTrigger")].find(
      (button) => button.getBoundingClientRect().width > 0,
    );
    check(
      helpButton?.closest(".appLegalLinks") &&
        helpButton.getBoundingClientRect().bottom <= innerHeight,
      "Help is not visible beside legal links",
    );
    helpButton.click();
    check(help === 1, "Footer Help did not open the guide");
    await typeSearch("needle");
    container
      .querySelector('.conversationSearch button[type="submit"]')
      .click();
    await wait();
    check(
      searches[0].get("channelId") === "channel-test" &&
        searches[0].get("q") === "needle",
      "Search request has wrong scope",
    );
    const bounds = container
      .querySelector(".messageSearchResults")
      .getBoundingClientRect();
    check(
      bounds.left >= 0 && bounds.right <= innerWidth,
      "Search results exceed viewport",
    );
    const resultRow = container.querySelector(".messageSearchResult");
    const resultName = resultRow.querySelector("strong"),
      resultTime = resultRow.querySelector("time"),
      resultText = resultRow.querySelector("p");
    check(
      Math.abs(
        resultName.getBoundingClientRect().left -
          resultText.getBoundingClientRect().left,
      ) < 1,
      "Search author and text are not left-aligned",
    );
    check(
      getComputedStyle(resultRow.querySelector("span")).justifyContent ===
        "flex-start" && getComputedStyle(resultText).textAlign === "left",
      "Search metadata or text remains centered/right-aligned",
    );
    check(
      resultTime.getBoundingClientRect().left >=
        resultName.getBoundingClientRect().left,
      "Search timestamp does not follow left-aligned metadata",
    );
    container.querySelector(".loadSearchResults").click();
    await wait();
    check(
      container.querySelectorAll(".messageSearchResult").length === 2,
      "Search pagination failed",
    );
    container.querySelector(".messageSearchResult").click();
    await wait();
    check(
      selected[0] === "message-26" &&
        !container.querySelector(".messageSearchResults"),
      "Search did not open selected context",
    );
    const target = container.querySelector('[data-search-match="true"]'),
      log = container.querySelector(".chatLog");
    check(
      container.querySelectorAll('[data-search-match="true"]').length === 1,
      "Search selection is duplicated",
    );
    check(
      target &&
        target.getBoundingClientRect().top >= log.getBoundingClientRect().top &&
        target.getBoundingClientRect().bottom <=
          log.getBoundingClientRect().bottom,
      "Search target did not scroll into view",
    );
    log.scrollTop = log.scrollHeight;
    log.dispatchEvent(new Event("scroll"));
    await wait();
    check(
      !container.querySelector(".searchContextNotice button"),
      "Search context retained a redundant return button",
    );
    check(
      container.querySelector(".jumpToPresent"),
      "Down arrow disappeared at the bottom of search context",
    );
    container.querySelector(".jumpToPresent").click();
    await wait();
    check(
      !container.querySelector(".searchContextNotice") &&
        container.querySelectorAll(".chatLog article").length === 1,
      "Down arrow did not exit search context and restore current history",
    );
    await typeSearch("slow");
    container
      .querySelector('.conversationSearch button[type="submit"]')
      .click();
    await wait();
    container.querySelector('[aria-label="Close search results"]').click();
    resolveSlow();
    await wait();
    check(
      !container.querySelector(".messageSearchResults") &&
        selected.length === 1,
      "Dismissed search reopened from a stale response",
    );
    return {
      editComposer: true,
      cancelRestoresDraft: true,
      editedLabel: true,
      ownerSettings: true,
      footerHelp: true,
      searchPaging: true,
      resultContext: true,
      returnToLatest: true,
      staleSearchIgnored: true,
    };
  } finally {
    window.fetch = originalFetch;
    root.unmount();
    container.remove();
  }
};
window.verifyNotifications = async () => {
  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:#1b2030;overflow:auto";
  document.body.append(container);
  const root = createRoot(container),
    originalFetch = window.fetch;
  const actor = "actor",
    friend = "friend",
    server = "server",
    channel = "channel",
    reads = [],
    writes = [],
    submitted = [],
    profiles = [];
  let state = {
    channels: [
      {
        id: channel,
        serverId: server,
        unread: true,
        mentions: 2,
        firstUnreadId: "51",
        latestMessageId: "60",
      },
    ],
    direct: [
      { id: friend, unread: 1, firstUnreadId: "dm", latestMessageId: "dm" },
    ],
    preferences: [],
  };
  window.fetch = async (url, options = {}) => {
    if (url === "/api/notifications" && options.method === "PATCH") {
      const body = JSON.parse(options.body);
      writes.push(body);
      let pref = state.preferences.find(
        (pref) => pref.scope === body.scope && pref.targetId === body.targetId,
      );
      if (!pref) {
        pref = {
          scope: body.scope,
          targetId: body.targetId,
          messages: true,
          mentions: true,
          calls: true,
          messageMuteUntil: null,
        };
        state.preferences.push(pref);
      }
      pref[body.kind] = body.mode !== "off";
      const timeKey =
        body.kind === "messages"
          ? "messageMuteUntil"
          : body.kind === "calls"
            ? "callMuteUntil"
            : "mentionMuteUntil";
      pref[timeKey] = ["on", "off"].includes(body.mode)
        ? null
        : new Date(Date.now() + Number(body.mode) * 60000).toISOString();
      return Response.json({ ok: true });
    }
    if (url === "/api/notifications/read") {
      reads.push(JSON.parse(options.body));
      state = {
        ...state,
        channels: state.channels.map((row) => ({
          ...row,
          unread: false,
          mentions: 0,
          firstUnreadId: null,
        })),
      };
      return Response.json({ ok: true });
    }
    if (url === "/api/notifications") return Response.json(state);
    return originalFetch(url, options);
  };
  let refresh;
  const people = [
    { id: "bob", name: "Bob Smith", handle: "bob.1234" },
    { id: "alice", name: "Alice", handle: "alice.5678" },
  ];
  function Fixture() {
    const [draft, setDraft] = useState(""),
      [latest, setLatest] = useState(false),
      [readEnabled, setReadEnabled] = useState(false),
      [muteTarget, setMuteTarget] = useState(null);
    const inbox = useNotificationInbox(
      actor,
      "access",
      readEnabled && latest
        ? {
            scope: "channel",
            targetId: channel,
            messageId: "60",
            canRead: () => latest,
          }
        : null,
    );
    useEffect(() => {
      refresh = inbox.refresh;
    }, [inbox.refresh]);
    const channelState = inbox.channels[0],
      allowedMessage = inbox.allowed("server", server, "messages"),
      allowedMention = inbox.allowed("server", server, "mentions"),
      allowedCall = inbox.allowed("direct", friend, "calls");
    return h(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: innerWidth < 650 ? "1fr" : "minmax(0,1fr) 320px",
          gap: 16,
          padding: 16,
        },
      },
      h(
        "section",
        { className: "chat", style: { height: 400, minHeight: 400 } },
        h(
          ChatHistory,
          {
            threadId: "notifications",
            messages: Array.from({ length: 60 }, (_, i) => ({
              id: String(i + 1),
              authorId: friend,
            })),
            ready: inbox.ready,
            hasMore: false,
            loadingOlder: false,
            onLoadOlder: async () => {},
            ownUserId: actor,
            firstUnreadId: "51",
            focusMessageId: inbox.ready ? "51" : undefined,
            onLatestVisibilityChange: (value) => {
              setLatest((current) => (current === value ? current : value));
            },
          },
          Array.from({ length: 60 }, (_, i) =>
            h(
              "article",
              {
                key: i,
                "data-message-id": String(i + 1),
                style: { minHeight: 60 },
              },
              `Message ${i + 1}`,
            ),
          ),
        ),
        h(
          "form",
          {
            onSubmit: (event) => {
              event.preventDefault();
              submitted.push(draft);
            },
          },
          h(MessageComposer, {
            value: draft,
            onChange: setDraft,
            files: [],
            onFiles() {},
            placeholder: "Message server",
            progress: null,
            mentionMembers: people,
          }),
          h("button", { type: "submit", "data-chat-send": true }, "Send"),
        ),
        h(
          "button",
          {
            type: "button",
            "data-enable-read": true,
            onClick: () => setReadEnabled(true),
          },
          "Open conversation",
        ),
      ),
      h(
        "section",
        null,
        h(
          "div",
          { className: "notificationBadgeProbe" },
          h(
            "button",
            {
              className: "workspaceButton",
              "data-server-badge": true,
              onContextMenu(event) {
                event.preventDefault();
                setMuteTarget({
                  scope: "server",
                  id: server,
                  name: "Test server",
                  x: 8,
                  y: 8,
                });
              },
            },
            "S",
            h(UnreadIndicator, {
              server: true,
              unread: allowedMessage && channelState?.unread,
              mentions: allowedMention ? channelState?.mentions : 0,
            }),
          ),
          h(
            "div",
            { className: "channelRow" },
            h(
              "button",
              { className: "channel", "data-channel-badge": true },
              h("span", { className: "channelName" }, "General"),
              h(UnreadIndicator, {
                unread: allowedMessage && channelState?.unread,
                mentions: allowedMention ? channelState?.mentions : 0,
              }),
            ),
          ),
        ),
        h(
          "p",
          { className: "mentionRenderProbe" },
          h(MentionText, {
            text: "Hi @bob.1234",
            mentions: [{ userId: "bob", name: "Bob Smith", start: 3, end: 12 }],
            onProfile: (user) => profiles.push(user),
          }),
        ),
        h(NotificationSettings, {
          servers: [{ id: server, name: "Test server" }],
          friends: [{ id: friend, name: "Friend" }],
          preferences: inbox.preferences,
          onSave: inbox.save,
        }),
        h(
          "button",
          {
            "data-person-mute": true,
            onContextMenu(event) {
              event.preventDefault();
              setMuteTarget({
                scope: "direct",
                id: friend,
                name: "Friend",
                x: 8,
                y: 8,
              });
            },
          },
          "Friend",
        ),
        muteTarget &&
          h(NotificationMuteMenu, {
            target: muteTarget,
            preferences: inbox.preferences,
            onSave: inbox.save,
            onClose: () => setMuteTarget(null),
          }),
        h(
          "div",
          { className: "callNotificationProbe" },
          h(IncomingCallNotice, {
            call: {
              fromUserId: friend,
              fromName: "Friend",
              roomId: "friend:actor:friend",
            },
            status: allowedCall ? "online" : "dnd",
            onAnswer() {},
            onDecline() {},
          }),
        ),
        h(
          "div",
          { className: "inlineCallNotificationProbe" },
          h(IncomingCallNotice, {
            call: {
              fromUserId: friend,
              fromName: "Friend",
              roomId: "friend:actor:friend",
            },
            conversationUserId: friend,
            inline: true,
            status: allowedCall ? "online" : "dnd",
            onAnswer() {},
            onDecline() {},
          }),
        ),
      ),
    );
  }
  async function type(value) {
    const textarea = container.querySelector("textarea");
    textarea.focus();
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    ).set.call(textarea, value);
    textarea.setSelectionRange(value.length, value.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    return textarea;
  }
  async function preference(label, mode) {
    const category = label.endsWith("Friend") ? "People" : "Servers";
    const categoryButton = [
      ...container.querySelectorAll(".notificationSettings button"),
    ].find((button) => button.textContent === category);
    categoryButton.click();
    await wait();
    const control = container.querySelector(`select[aria-label="${label}"]`);
    control.value = mode;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
  }
  try {
    flushSync(() => root.render(h(Fixture)));
    await wait();
    await wait();
    async function searchSettings(query) {
      const input = container.querySelector(
        '.notificationSettings input[type="search"]',
      );
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait();
    }
    await searchSettings("missing");
    check(
      !container.querySelector(
        ".notificationSettings .notificationPreference",
      ) &&
        container
          .querySelector(".notificationSettings")
          .textContent.includes("No matches found"),
      "Server notification search did not filter",
    );
    await searchSettings("test");
    check(
      container.querySelector(
        ".notificationSettings .notificationPreference strong",
      )?.textContent === "Test server",
      "Server search did not match case insensitively",
    );
    [...container.querySelectorAll(".notificationSettings button")]
      .find((button) => button.textContent === "People")
      .click();
    await wait();
    check(
      !container.querySelector(
        'select[aria-label="mentions notifications for Test server"]',
      ) &&
        container.querySelector(
          'select[aria-label="calls notifications for Friend"]',
        ),
      "People and server controls were not separated",
    );
    await searchSettings("missing");
    check(
      !container.querySelector(".notificationSettings .notificationPreference"),
      "People notification search did not filter",
    );
    await searchSettings("");
    [...container.querySelectorAll(".notificationSettings button")]
      .find((button) => button.textContent === "Servers")
      .click();
    await wait();
    check(
      container.querySelector(".notificationSettings input").value === "test",
      "Switching categories lost the server search",
    );
    await searchSettings("");
    const label = container
      .querySelector("[data-channel-badge] .channelName")
      .getBoundingClientRect();
    const indicator = container
      .querySelector("[data-channel-badge] .activityIndicator")
      .getBoundingClientRect();
    check(
      Math.abs(
        label.top + label.height / 2 - (indicator.top + indicator.height / 2),
      ) < 1 && indicator.left - label.right <= 7,
      "Channel indicator is not centered next to its label",
    );
    check(
      container.querySelectorAll(".newMessagesDivider").length === 1,
      "New messages divider is missing or duplicated",
    );
    check(
      reads.length === 0,
      "Opening unread history acknowledged messages before reaching the bottom",
    );
    check(
      container.querySelectorAll(".activityMentionCount").length === 2,
      "Channel/server mention counts do not share a badge position",
    );
    check(
      container.querySelector("[data-server-badge] .activityDot") &&
        container.querySelector("[data-channel-badge] .activityDot"),
      "Mention counts have no underlying generic indicator",
    );
    let textarea = await type("@");
    check(
      container.querySelectorAll('[role="option"]').length === 2,
      "@ must list all other server members",
    );
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check(
      textarea.value === "@bob.1234 " && submitted.length === 0,
      "Mention selection submitted instead of inserting a unique handle",
    );
    await type("@Ali");
    check(
      container.querySelectorAll('[role="option"]').length === 1,
      "Mention filtering is wrong",
    );
    container.querySelector('[role="option"]').click();
    await wait();
    check(textarea.value === "@alice.5678 ", "Mouse mention selection failed");
    await type("hello @Bob Smith");
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    container.querySelector("[data-chat-send]").click();
    await wait();
    check(
      submitted[0] === "hello @Bob Smith",
      "Manually typed mention text was not sent",
    );
    container.querySelector(".messageMention").click();
    check(
      profiles[0].id === "bob",
      "Mention did not open the selected user's profile",
    );
    await preference("messages notifications for Test server", "off");
    check(
      container.querySelector("[data-server-badge] .activityMentionCount")
        ?.textContent === "2",
      "Disabling normal messages suppressed mentions",
    );
    await preference("messages notifications for Friend", "off");
    check(
      container.querySelector(".callNotificationProbe .incomingCall"),
      "Disabling DM messages suppressed calls",
    );
    await preference("calls notifications for Friend", "off");
    check(
      !container.querySelector(".callNotificationProbe .incomingCall") &&
        container.querySelector(".inlineCallNotificationProbe .incomingCall"),
      "Call mute did not silence popup while preserving inline Answer",
    );
    await preference("mentions notifications for Test server", "off");
    check(
      !container.querySelector(".activityIndicator"),
      "Fully muted server retained alert badges",
    );
    await preference("messages notifications for Test server", "on");
    check(
      container.querySelector("[data-server-badge] .activityDot") &&
        !container.querySelector("[data-server-badge] .activityMentionCount"),
      "Normal unread messages should have only a generic mark",
    );
    await preference("calls notifications for Friend", "60");
    check(
      container.querySelector(
        'select[aria-label="calls notifications for Friend"]',
      ).value === "muted",
      "Temporary mute did not persist",
    );
    for (const [selector, name, scope] of [
      ["[data-server-badge]", "Test server", "server"],
      ["[data-person-mute]", "Friend", "direct"],
    ]) {
      container
        .querySelector(selector)
        .dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      await wait();
      const menu = container.querySelector(".notificationMuteMenu");
      check(
        menu?.getAttribute("aria-label") === `Mute notifications for ${name}`,
        "Right-click did not open the correct mute options",
      );
      const control = menu.querySelector(
        `select[aria-label="messages notifications for ${name}"]`,
      );
      control.value = "60";
      control.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      check(
        writes.some(
          (write) =>
            write.scope === scope &&
            write.kind === "messages" &&
            write.mode === "60",
        ),
        "Context mute was not persisted through the normal settings API",
      );
      check(
        menu.querySelector(
          `select[aria-label="messages notifications for ${name}"]`,
        ).value === "muted",
        "Context mute did not refresh saved preferences",
      );
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await wait();
      check(
        !container.querySelector(".notificationMuteMenu"),
        "Escape did not close mute options",
      );
    }
    container.querySelector("[data-enable-read]").click();
    await wait();
    check(reads.length === 0, "Older visible messages cleared unseen activity");
    const log = container.querySelector(".chatLog");
    log.scrollTop = log.scrollHeight;
    log.dispatchEvent(new Event("scroll"));
    await wait();
    await wait();
    check(
      reads.length === 1 &&
        reads[0].scope === "channel" &&
        reads[0].messageId === "60",
      "Reaching latest did not acknowledge the visible conversation exactly once",
    );
    check(
      !container.querySelector(".activityIndicator"),
      "Read acknowledgement did not clear indicators",
    );
    state = {
      ...state,
      channels: state.channels.map((row) => ({
        ...row,
        unread: true,
        mentions: 1,
      })),
    };
    refresh();
    await new Promise((resolve) => setTimeout(resolve, 160));
    check(
      writes.some(
        (write) => write.scope === "direct" && write.kind === "calls",
      ) &&
        writes.some(
          (write) => write.scope === "direct" && write.kind === "messages",
        ),
      "DM message/call controls were not independent requests",
    );
    return {
      mentionPicker: true,
      keyboardSelection: true,
      typedMentions: true,
      mentionProfile: true,
      newDivider: true,
      overlaidBadges: true,
      separateDmControls: true,
      temporaryMute: true,
      readAtLatest: true,
      notificationSearch: true,
      separateCategories: true,
      centeredChannelBadge: true,
      contextMutes: true,
    };
  } finally {
    root.unmount();
    window.fetch = originalFetch;
    container.remove();
  }
};
window.verifyHelpAndSkeletons = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const target = document.createElement("button");
  target.className = "workspaceLogo";
  target.style.cssText =
    "position:fixed;left:18px;top:80px;width:46px;height:46px;z-index:50";
  target.textContent = "LC";
  document.body.append(target);
  // Isolate geometry checks from controls in the background workspace fixture.
  const otherTargets = [
    ...document.querySelectorAll(
      ".workspaceLogo, .friendSearchForm, .friendsSidebar",
    ),
  ]
    .filter((element) => element !== target)
    .map((element) => ({ element, visibility: element.style.visibility }));
  otherTargets.forEach(({ element }) => {
    element.style.visibility = "hidden";
  });
  let root = createRoot(container);
  const userId = `help-browser-${Math.random()}`,
    otherUser = `${userId}-other`;
  const key = `lc.help.dismissed:${userId}`;
  const visitedSteps = [];
  const waitForHighlight = async (condition) => {
    for (let attempt = 0; attempt < 25 && !condition(); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const render = async (requestKey = 0, id = userId) => {
    root.render(
      h(HelpTour, {
        key: id,
        userId: id,
        requestKey,
        onStepChange: (step) => visitedSteps.push(step),
        profile: { name: "Taylor", status: "Away", statusCode: "away" },
      }),
    );
    await wait();
  };
  const click = async (label) => {
    const button = [...document.querySelectorAll(".helpTour button")].find(
      (item) => item.textContent === label,
    );
    check(button, `${label} button must exist`);
    button.click();
    await wait();
  };
  try {
    await render();
    check(
      document.querySelector(".helpTour[open]") &&
        document
          .querySelector(".helpStep")
          .textContent.includes("Welcome to LC"),
      "The introduction must open automatically for a new account",
    );
    const initialWindow = document
      .querySelector(".helpTour")
      .getBoundingClientRect();
    const dragHeader = document.querySelector(".helpTour header");
    dragHeader.focus();
    dragHeader.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    const movedWindow = document
      .querySelector(".helpTour")
      .getBoundingClientRect();
    check(
      movedWindow.top === initialWindow.top + 10,
      "The guide header must support keyboard movement",
    );
    await click("Next");
    check(
      visitedSteps.at(-1) === 1,
      "Friends guidance must request the actual Friends workspace",
    );
    await waitForHighlight(() => document.querySelector(".helpTargetOutline"));
    const nextWindow = document
      .querySelector(".helpTour")
      .getBoundingClientRect();
    check(
      nextWindow.left === movedWindow.left &&
        nextWindow.top === movedWindow.top &&
        nextWindow.width === movedWindow.width,
      "Changing steps or highlights must not move or resize the guide window",
    );
    const outlines = [...document.querySelectorAll(".helpTargetOutline")];
    const targetBox = target.getBoundingClientRect();
    check(
      outlines.some(
        (outline) =>
          Math.abs(Number(outline.getAttribute("x")) - (targetBox.left - 5)) <
            1 &&
          Math.abs(
            Number(outline.getAttribute("width")) - (targetBox.width + 10),
          ) < 1,
      ),
      `Friends step must highlight the actual LC control ${JSON.stringify({ target: targetBox.toJSON(), outlines: outlines.map((item) => ({ x: item.getAttribute("x"), width: item.getAttribute("width") })), active: document.querySelector(".helpTour").getAttribute("data-help-spotlight") })}`,
    );
    const canvas = document
      .querySelector(".helpSpotlightCanvas")
      .getBoundingClientRect();
    check(
      canvas.left === 0 && canvas.top === 0 && canvas.width === innerWidth,
      "Spotlight coordinates must stay aligned with the viewport despite dialog positioning",
    );
    const surface = document.querySelector(".helpTour .settingsModalSurface");
    check(
      Number(getComputedStyle(surface).zIndex) >
        Number(
          getComputedStyle(document.querySelector(".helpSpotlightCanvas"))
            .zIndex,
        ) && getComputedStyle(surface).backgroundColor !== "rgba(0, 0, 0, 0)",
      "An opaque guide surface must paint above the entire spotlight, including its outlines",
    );
    target.style.left = "94px";
    await waitForHighlight(() =>
      [...document.querySelectorAll(".helpTargetOutline")].some(
        (outline) => Math.abs(Number(outline.getAttribute("x")) - 89) < 1,
      ),
    );
    check(
      [...document.querySelectorAll(".helpTargetOutline")].some(
        (outline) => Math.abs(Number(outline.getAttribute("x")) - 89) < 1,
      ),
      "Highlights must follow layout changes",
    );
    target.style.display = "none";
    await waitForHighlight(() => !document.querySelector(".helpTargetOutline"));
    check(
      !document.querySelector(".helpTargetOutline") &&
        document.querySelector(".helpTargetHint"),
      "Hidden controls must not leave phantom highlights and must explain where to find them",
    );
    target.style.display = "block";
    await waitForHighlight(() => document.querySelector(".helpTargetOutline"));
    check(
      document.querySelector(".helpProgress").textContent.includes("Step 2"),
      "Next must advance one step",
    );
    await click("Skip");
    check(
      !document.querySelector(".helpSpotlightCanvas"),
      "Skipping must remove all highlights",
    );
    check(
      document.querySelector(".helpPreference"),
      "Skipping must offer Do not show again",
    );
    const preference = document.querySelector(".helpPreference input");
    check(preference.checked, "Do not show again must be checked by default");
    await click("Done");
    check(
      !document.querySelector(".helpTour") &&
        localStorage.getItem(key) === "true",
      "Skip must persist the explicit preference and close",
    );
    root.unmount();
    root = createRoot(container);
    await render();
    check(
      !document.querySelector(".helpTour"),
      "Reloading with opt-out must not automatically reopen the introduction",
    );
    await render(1);
    check(
      document.querySelector(".helpTour[open]"),
      "Help must reopen the tour even after opting out",
    );
    for (let step = 1; step < helpSteps.length; step++) {
      await click("Next");
      if (step === 5) {
        const preview = document.querySelector(".helpCallPreview");
        const previewBox = preview.getBoundingClientRect();
        const toolbar = preview.querySelector(".helpPreviewControls");
        const toolbarBox = toolbar.getBoundingClientRect();
        const actions = toolbar.querySelectorAll(":scope > button");
        check(
          Math.abs(
            actions[0].getBoundingClientRect().width -
              actions[1].getBoundingClientRect().width,
          ) < 1 &&
            Math.abs(
              actions[1].getBoundingClientRect().right -
                (toolbarBox.right - 10),
            ) < 1,
          "Share screen and Soundboard must stretch evenly across the remaining toolbar width",
        );
        const guideSurface = document.querySelector(
          ".helpTour .settingsModalSurface",
        );
        check(
          !guideSurface.contains(preview) &&
            Number(getComputedStyle(guideSurface).zIndex) >
              Number(getComputedStyle(preview).zIndex),
          "The guide must remain above the connected-call example when dragged over it",
        );
        check(
          preview.querySelectorAll(".deviceControl").length === 3 &&
            preview.querySelector(".helpPreviewControls .mediaDisabled"),
          "The example must reuse camera-off, microphone and headphone device controls",
        );
        check(
          preview.querySelector(".helpPreviewStatus strong").textContent ===
            "Connected" &&
            preview
              .querySelector(".helpPreviewIdentity")
              .textContent.includes("Taylor") &&
            preview
              .querySelector(".helpPreviewIdentity")
              .textContent.includes("Away"),
          "The example must show the current profile and a connected status without a channel name",
        );
        check(
          Math.abs(previewBox.bottom - (innerHeight - 8)) < 1 &&
            previewBox.left >= 8 &&
            previewBox.right <= innerWidth,
          "Connected-call example must sit at the bottom-left within the viewport",
        );
        check(
          preview?.textContent.includes("Connected") &&
            preview.textContent.includes("Share screen") &&
            preview.textContent.includes("Soundboard"),
          "Media guidance must show a connected call example",
        );
        check(
          [...preview.querySelectorAll("button")].every(
            (button) => button.disabled,
          ) && !preview.querySelector("audio, video"),
          "The example must not start media or allow real call actions",
        );
      }
    }
    check(
      document.querySelector(".helpPreference") &&
        document
          .querySelector(".helpProgress")
          .textContent.includes(`Step ${helpSteps.length}`),
      "The final step must offer Do not show again",
    );
    document.querySelector(".helpPreference input").click();
    await wait();
    await click("Finish");
    check(
      localStorage.getItem(key) === "false",
      "Unchecking the preference must enable future automatic tours",
    );
    await render(1, otherUser);
    check(
      document.querySelector(".helpTour[open]"),
      "One account's tour preference must not suppress another account's introduction",
    );
    await click("Skip");
    await click("Done");
    for (const kind of ["channels", "messages", "sounds"]) {
      flushSync(() => root.render(h(LoadingSkeleton, { kind, key: kind })));
      const skeleton = container.querySelector('[role="status"]');
      check(
        skeleton?.getAttribute("aria-label") === `Loading ${kind}` &&
          !skeleton.querySelector("button"),
        "Skeletons must announce loading without offering fake interactive controls",
      );
      check(
        container.querySelectorAll(".skeletonRow").length ===
          (kind === "sounds" ? 6 : 5),
        "Skeleton rows must match the intended layout",
      );
      const row = skeleton.querySelector(".skeletonRow");
      check(
        getComputedStyle(row).visibility === "hidden",
        "Brief loading must reserve space without flashing gray skeletons",
      );
      await new Promise((resolve) => setTimeout(resolve, 190));
      check(
        getComputedStyle(row).visibility === "visible",
        "A slower request must still reveal the loading skeleton",
      );
      if (matchMedia("(prefers-reduced-motion: reduce)").matches)
        check(
          getComputedStyle(row.querySelector(".skeletonShape"))
            .animationName === "none",
          "Delayed loading must preserve reduced-motion support",
        );
    }
  } finally {
    root.unmount();
    container.remove();
    target.remove();
    otherTargets.forEach(({ element, visibility }) => {
      element.style.visibility = visibility;
    });
    localStorage.removeItem(key);
    localStorage.removeItem(`lc.help.dismissed:${otherUser}`);
  }
};
window.mountMovableHelpTest = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    h(HelpTour, { userId: `drag-help-${Math.random()}`, requestKey: 0 }),
  );
  await wait();
  const rect = document.querySelector(".helpTour").getBoundingClientRect();
  const header = document
    .querySelector(".helpTour header")
    .getBoundingClientRect();
  window.readMovableHelpTest = () => {
    const rect = document.querySelector(".helpTour").getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  };
  window.advanceMovableHelpTest = async () => {
    [...document.querySelectorAll(".helpTour button")]
      .find((button) => button.textContent === "Next")
      .click();
    await wait();
    return window.readMovableHelpTest();
  };
  window.cleanupMovableHelpTest = () => {
    root.unmount();
    container.remove();
  };
  return { x: header.left + 20, y: header.top + 10, top: rect.top };
};
window.verifyVoiceParticipantMenu = async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const moved = [];
  let closed = 0;
  try {
    root.render(
      h(VoiceParticipantMenu, {
        x: innerWidth - 30,
        y: innerHeight - 30,
        channels: Array.from({ length: 20 }, (_, index) => ({
          id: String(index),
          name: `Voice ${index}`,
        })),
        onClose: () => closed++,
        onKick() {},
        onMove: (id) => moved.push(id),
      }),
    );
    await wait();
    check(
      container.querySelector("button").textContent === "Kick",
      "Kick must use the short label",
    );
    container
      .querySelector(".voiceMoveItem")
      .dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    await wait();
    const submenu = container.querySelector(".voiceMoveMenu");
    check(
      submenu?.querySelectorAll("button").length === 20,
      "Hover must list every destination voice channel",
    );
    const rect = submenu.getBoundingClientRect();
    check(
      rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
      "Move submenu must fit within the viewport",
    );
    submenu.dispatchEvent(new Event("scroll"));
    check(closed === 0, "Scrolling the destination list must keep it open");
    submenu.querySelector("button").click();
    check(
      moved[0] === "0" && closed === 1,
      "Choosing a destination closes and moves",
    );
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    check(closed === 2, "Clicking outside must dismiss voice actions");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    check(closed === 3, "Escape must dismiss voice actions");
  } finally {
    root.unmount();
    container.remove();
  }
};
window.verifyCallContext = async () => {
  const container = document.createElement("div");
  container.className = "workspace";
  container.style.cssText = "position:fixed;inset:0;z-index:80";
  document.body.append(container);
  const root = createRoot(container);
  const callAudio = window.workspaceAudio.element;
  let answers = 0,
    declines = 0;
  const call = {
    fromUserId: "alice",
    fromName: "Alice",
    roomId: friendCallRoom("me", "alice"),
  };
  function Fixture({ status, selected, activeRoom }) {
    const active = conversationHasCall(activeRoom, "me", selected);
    return h(
      React.Fragment,
      null,
      h(IncomingCallNotice, {
        call,
        status,
        conversationUserId: selected,
        onAnswer: () => answers++,
        onDecline: () => declines++,
      }),
      h(
        "section",
        { className: `chat directMessages ${active ? "callActive" : ""}` },
        h(IncomingCallNotice, {
          call,
          status,
          conversationUserId: selected,
          inline: true,
          onAnswer: () => answers++,
          onDecline: () => declines++,
        }),
      ),
      h(
        "section",
        { className: `friendsCallPanel ${active ? "" : "controlsOnly"}` },
        h("div", { className: "friendsCallIdentity" }, "Active call"),
        h("div", { className: "videoGrid" }),
        h("div", { className: "voiceDock" }, "Call controls"),
      ),
    );
  }
  const render = async (props) => {
    root.render(h(Fixture, props));
    await wait();
  };
  try {
    await render({
      status: "dnd",
      selected: "bob",
      activeRoom: "server-channel",
    });
    check(
      !container.querySelector(".incomingCall"),
      "DND must not display an incoming-call popup in another conversation",
    );
    check(
      !container.querySelector(".callActive") &&
        getComputedStyle(container.querySelector(".friendsCallIdentity"))
          .display === "none",
      "A server voice room must not appear as an active DM call",
    );
    check(
      getComputedStyle(container.querySelector(".voiceDock")).display !==
        "none",
      "Server call controls must remain available in Friends",
    );
    await render({
      status: "dnd",
      selected: "alice",
      activeRoom: "server-channel",
    });
    const inline = container.querySelector(".incomingCallInline");
    check(
      inline && !container.querySelector('[role="dialog"]'),
      "The caller's DM must show an inline invitation while DND suppresses popups",
    );
    inline.querySelector(".primary").click();
    inline.querySelector(".danger").click();
    check(
      answers === 1 && declines === 1,
      "Inline Answer and Decline must remain usable",
    );
    await render({
      status: "online",
      selected: "bob",
      activeRoom: friendCallRoom("me", "alice"),
    });
    check(
      container.querySelector('[role="dialog"]') &&
        !container.querySelector(".callActive"),
      "A call with Alice must not activate Bob's DM",
    );
    await render({
      status: "online",
      selected: "alice",
      activeRoom: friendCallRoom("me", "alice"),
    });
    check(
      container.querySelector(".callActive") &&
        !container.querySelector(".friendsCallPanel.controlsOnly"),
      "Only the matching DM must show the active friend call",
    );
    check(
      callAudio.isConnected &&
        !callAudio.paused &&
        window.workspaceAudio.element === callAudio,
      "Call presentation changes must preserve persistent call audio",
    );
  } finally {
    root.unmount();
    container.remove();
  }
};
window.mountServerTooltipTest = async () => {
  const container = document.createElement("div");
  container.className = "workspace serverListToggled";
  container.style.cssText = "position:fixed;inset:0;z-index:100";
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    h(
      "aside",
      { className: "workspaceRail" },
      h(ServerNavButton, {
        server: { id: "tooltip", name: "Tooltip server" },
        voiceUsers: [],
        onClick() {},
        onContextMenu() {},
      }),
    ),
  );
  await wait();
  const button = container.querySelector("button");
  const rect = button.getBoundingClientRect();
  window.readServerTooltipTest = () => ({
    focused: document.activeElement === button,
    opacity: getComputedStyle(container.querySelector('[role="tooltip"]'))
      .opacity,
  });
  window.cleanupServerTooltipTest = () => {
    root.unmount();
    container.remove();
  };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};
window.verifyWorkspaceActivity = async () => {
  const originalFetch = window.fetch;
  const originalVisibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  // Headless targets can be backgrounded independently of the simulated UI.
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  const userId = `activity-browser-${Math.random()}`;
  const rows = [
    {
      id: "text",
      serverId: "one",
      type: "text",
      latestMessageId: "old",
      latestMessageAt: "2026-11-03T12:00:00Z",
    },
    {
      id: "voice",
      serverId: "one",
      type: "voice_group",
      latestMessageId: null,
      latestMessageAt: null,
    },
    {
      id: "other",
      serverId: "two",
      type: "text",
      latestMessageId: null,
      latestMessageAt: null,
    },
  ];
  window.fetch = async (url) => {
    check(
      url === "/api/workspace-activity",
      "Activity must use the authorized snapshot route",
    );
    return Response.json(rows);
  };
  const container = document.createElement("div");
  container.className = `workspace ${innerWidth <= 650 ? "serverListToggled" : ""}`;
  container.style.cssText = "position:fixed;inset:0;z-index:80";
  document.body.append(container);
  const root = createRoot(container);
  let activity;
  let updateVoiceUsers;
  function ActivityFixture() {
    const [selected, setSelected] = useState("");
    const [voiceUsers, setVoiceUsers] = useState([
      { userId: "person", name: "Grace" },
    ]);
    const current = useWorkspaceActivity(userId, "one,two", selected);
    useEffect(() => {
      activity = current;
      updateVoiceUsers = setVoiceUsers;
    }, [current]);
    return h(
      React.Fragment,
      null,
      h(
        "aside",
        { className: "workspaceRail" },
        h(
          "nav",
          { className: "serverScroller" },
          ...["one", "two"].map((id) =>
            h(ServerNavButton, {
              key: id,
              server: {
                id,
                name: id === "one" ? "First server" : "Other server",
              },
              unread: current.channels.some(
                (channel) =>
                  channel.serverId === id && current.unread[channel.id],
              ),
              voiceUsers: id === "one" ? voiceUsers : [],
              onClick() {},
              onContextMenu(event) {
                event.preventDefault();
              },
            }),
          ),
        ),
      ),
      h(
        "button",
        {
          className: "channel",
          style: { position: "fixed", left: 120, top: 160 },
          onClick: () => setSelected("text"),
        },
        "General",
        current.unread.text &&
          h("span", {
            className: "channelUnreadDot",
            "aria-label": "Unread messages",
          }),
      ),
    );
  }
  try {
    root.render(h(ActivityFixture));
    await wait();
    check(
      !container.querySelector(".serverActivityIndicator"),
      "Existing history must not start unread on first visit",
    );
    activity.handle({
      type: "channel-activity",
      channelId: "text",
      messageId: "new",
      createdAt: "2026-11-03T12:01:00Z",
      authorId: "other",
    });
    await wait();
    check(
      container.querySelectorAll(".serverActivityIndicator").length === 1 &&
        container.querySelector(".channelUnreadDot"),
      "New activity must badge the server and channel",
    );
    const first = container.querySelector(".workspaceButton");
    first.focus();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const tooltip = container.querySelector('[role="tooltip"]');
    check(
      getComputedStyle(tooltip).opacity === "1" &&
        tooltip.textContent.includes("Grace"),
      "Keyboard focus must show voice participant names",
    );
    check(
      tooltip.querySelector(".serverTooltipPerson").getBoundingClientRect()
        .top > tooltip.querySelector("strong").getBoundingClientRect().top &&
        container.querySelector(".serverVoiceBadge"),
      "Voice badge and names below server title must be visible",
    );
    updateVoiceUsers([
      { userId: "person", name: "Grace" },
      { userId: "second", name: "Ada" },
    ]);
    await wait();
    check(
      container.querySelector(".serverVoiceBadge").textContent === "2" &&
        tooltip.textContent.includes("Ada"),
      "A live join updates the count and tooltip without server navigation",
    );
    updateVoiceUsers([]);
    await wait();
    check(
      !container.querySelector(".serverVoiceBadge") &&
        !tooltip.querySelector(".serverTooltipPerson"),
      "The final departure clears the voice badge and tooltip occupants",
    );
    container.querySelector(".channel").click();
    await wait();
    check(
      !container.querySelector(".serverActivityIndicator") &&
        !container.querySelector(".channelUnreadDot"),
      "Reading the visible channel must clear its notifications",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    activity.handle({
      type: "channel-activity",
      channelId: "text",
      messageId: "hidden",
      createdAt: "2026-11-03T12:02:00Z",
      authorId: "other",
    });
    await wait();
    check(
      container.querySelector(".serverActivityIndicator"),
      "A hidden tab must retain unread activity in its selected channel",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await wait();
    check(
      !container.querySelector(".serverActivityIndicator"),
      "Returning to the visible channel must clear unread activity",
    );
    check(
      localStorage.getItem(`lc.channelReads.${userId}`).includes("hidden"),
      "Read markers must persist per account",
    );
  } finally {
    if (originalVisibility)
      Object.defineProperty(document, "visibilityState", originalVisibility);
    else delete document.visibilityState;
    root.unmount();
    container.remove();
    window.fetch = originalFetch;
    localStorage.removeItem(`lc.channelReads.${userId}`);
  }
};
async function playSoundPreview(audio, label) {
  check(audio instanceof HTMLAudioElement, `${label}: audio element missing`);
  let timer, onReady, onError;
  try {
    await new Promise((resolve, reject) => {
      let started = false;
      onReady = () => {
        if (started || audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA)
          return;
        started = true;
        void audio.play().then(resolve, reject);
      };
      onError = () =>
        reject(
          new Error(
            `${label}: preview did not start (readyState=${audio.readyState}, networkState=${audio.networkState}, error=${audio.error?.code ?? "none"}, hasSource=${Boolean(audio.getAttribute("src"))})`,
          ),
        );
      timer = setTimeout(onError, 4000);
      audio.addEventListener("canplay", onReady);
      audio.addEventListener("error", onError);
      if (audio.error) onError();
      else onReady();
    });
    check(!audio.paused, `${label}: preview must be playing`);
  } catch (error) {
    audio.pause();
    throw error;
  } finally {
    clearTimeout(timer);
    audio.removeEventListener("canplay", onReady);
    audio.removeEventListener("error", onError);
  }
}

async function verifyModeratorControls() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const changes = [];
  function Members() {
    const [members, setMembers] = useState([
      { id: "owner", name: "Owner", role: "owner" },
      { id: "member", name: "Member", role: "member", canBeModerator: true },
      { id: "demo", name: "Demo", role: "member", canBeModerator: false },
    ]);
    return h(SettingsMembers, {
      members,
      onRoleChange: async (member, role) => {
        changes.push([member.id, role]);
        setMembers((current) =>
          current.map((item) =>
            item.id === member.id ? { ...item, role } : item,
          ),
        );
      },
    });
  }
  try {
    flushSync(() => root.render(h(Members)));
    const promote = [
      ...host.querySelectorAll(".promotionOption > button"),
    ].filter(
      (button) => button.textContent === "Moderator" && !button.disabled,
    );
    check(
      promote.length === 1,
      "Only an eligible non-owner has the moderator promotion action",
    );
    promote[0].click();
    await wait();
    const demote = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Demote to member",
    );
    check(
      demote && changes[0][1] === "mod",
      "Owners can promote members to moderator",
    );
    demote.click();
    await wait();
    check(
      changes[1][1] === "member",
      "Owners can demote moderators back to members",
    );
  } finally {
    root.unmount();
    host.remove();
  }
}

async function measureSoundboardStartup() {
  const context = new AudioContext();
  const wave = soundWave("celebrate-v1");
  const bytes = wave.buffer.slice(
    wave.byteOffset,
    wave.byteOffset + wave.byteLength,
  );
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const samples = { sequential: [], parallel: [] };
  let readyPlayer;
  try {
    await context.resume();
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const parallel of [false, true]) {
        let allowed = false,
          started;
        const player = new SoundPlayer(undefined, (playing) => {
          if (playing) started = performance.now();
        });
        const authorize = async () => {
          await delay(80);
          allowed = true;
        };
        const start = performance.now();
        try {
          await player.play(
            context,
            async () => {
              await delay(80);
              return bytes;
            },
            async () => {
              if (!parallel) await authorize();
              check(allowed, "Latency probe published before permission");
              await delay(20);
              return () => {};
            },
            parallel ? authorize : undefined,
          );
          check(started !== undefined, "Latency probe did not start audio");
          samples[parallel ? "parallel" : "sequential"].push(started - start);
        } finally {
          player.stop();
        }
      }
    }
    const median = (values) => Math.round([...values].sort((a, b) => a - b)[1]);
    const sequentialMs = median(samples.sequential),
      parallelMs = median(samples.parallel);
    let readyPublications = 0;
    const readySamples = [];
    readyPlayer = new SoundPlayer(undefined, undefined, true);
    await readyPlayer.preload(context, async () => bytes);
    const publishReady = async () => {
      readyPublications++;
      await delay(20);
      return () => {};
    };
    await readyPlayer.prepare(context, publishReady);
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = performance.now();
      await readyPlayer.play(
        context,
        async () => bytes,
        publishReady,
        async () => {
          await delay(80);
        },
      );
      readySamples.push(performance.now() - start);
    }
    check(
      readyPublications === 1,
      "Prepared playback republished the audio track",
    );
    return {
      sequentialMs,
      parallelMs,
      preloadedReadyMs: median(readySamples),
      readyPublications,
      savedMs: sequentialMs - parallelMs,
      simulatedDownloadMs: 80,
      simulatedPermitMs: 80,
      simulatedPublishMs: 20,
      samplesPerMode: 3,
    };
  } finally {
    readyPlayer?.stop();
    await context.close();
  }
}

window.measureSoundboardStartup = measureSoundboardStartup;

async function verifySoundboard() {
  const startupLatency = await measureSoundboardStartup();
  const savedPreferences = ["lc.soundboardVolume", "lc.soundboardMuted"].map(
    (key) => [key, localStorage.getItem(key)],
  );
  localStorage.setItem("lc.soundboardVolume", "100");
  localStorage.setItem("lc.soundboardMuted", "false");
  await verifyModeratorControls();
  const originalFetch = window.fetch;
  let permits = 0,
    publications = 0,
    previewTrack,
    publishedTrack;
  const speaking = [];
  const soundList = [
    { id: "celebrate-v1", name: "Celebrate", serverId: "call-server" },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `clip-${i}`,
      name:
        i === 6
          ? "A very long custom sound name that must use an ellipsis"
          : `Sound ${i + 2}`,
      serverId: "call-server",
    })),
  ];
  let uploads = 0,
    removals = 0;
  const joinSoundChanges = [];
  let canManageSounds = true;
  let canUploadSounds = true;
  window.fetch = async (url, options = {}) => {
    if (String(url).startsWith("/api/servers/call-server/join-sound?"))
      return Response.json({ joinSoundId: "celebrate-v1" });
    if (String(url) === "/api/servers/call-server/join-sound") {
      check(
        options.method === "PATCH",
        "Join sound changes must be saved on the server",
      );
      const body = JSON.parse(options.body);
      joinSoundChanges.push(
        Object.hasOwn(body, "joinSoundId")
          ? body.joinSoundId
          : body.leaveSoundId,
      );
      return Response.json(body);
    }
    check(
      String(url).startsWith("/api/servers/call-server/soundboard"),
      "The board must use the active call's server",
    );
    if (String(url).includes("/soundboard/play?")) {
      permits++;
      return Response.json({ allowed: true });
    }
    if (options.method === "POST") {
      check(
        options.body instanceof File && options.body.size > 44,
        "Custom uploads must send the selected WAV clip",
      );
      const uploadedBytes = await options.body.arrayBuffer();
      const uploadedView = new DataView(uploadedBytes);
      check(
        uploadedView.getUint32(24, true) === 48000 &&
          uploadedView.getUint32(40, true) === 48000 * 2 * 0.2,
        "Only the selected 0.2 seconds are converted to WAV and uploaded",
      );
      uploads++;
      const uploaded = {
        id: "custom-test",
        name: "Uploaded",
        serverId: "call-server",
        custom: true,
      };
      soundList.push(uploaded);
      return Response.json({
        id: "custom-test",
        name: "Uploaded",
        serverId: "call-server",
        custom: true,
      });
    }
    if (options.method === "DELETE") {
      removals++;
      soundList.splice(
        soundList.findIndex((sound) => sound.id === "custom-test"),
        1,
      );
      return Response.json({ id: "custom-test" });
    }
    return String(url).includes("?clip=")
      ? new Response(soundWave("celebrate-v1"))
      : Response.json({
          canManage: canManageSounds,
          canUpload: canUploadSounds,
          sounds: soundList,
        });
  };
  const container = document.createElement("div");
  container.className = "workspace";
  container.style.setProperty("--sidebar-width", "360px");
  document.body.append(container);
  const root = createRoot(container);
  const publish = async (track) => {
    publications++;
    publishedTrack = track;
    return () => {};
  };
  let boardActions;
  function Board() {
    const board = useSoundboard("call", {
      serverId: "call-server",
      onSpeakingChange: (value) => speaking.push(value),
    });
    useEffect(() => {
      boardActions = board;
    });
    return h(
      "div",
      { className: "controls voiceDock" },
      h("button", null, "Camera"),
      h("button", null, "Share screen"),
      h(SoundboardButton, {
        board,
        serverId: "call-server",
        serverName: "Call server",
        disabled: false,
        publish,
      }),
    );
  }
  try {
    root.render(h(Board));
    await wait();
    const trigger = container.querySelector(".soundboardButton");
    trigger.click();
    await wait();
    const panel = container.querySelector(".soundboardDropup");
    const soundboardTrigger = container.querySelector(".soundboardButton");
    soundboardTrigger.style.width = "70px";
    const triggerLabel = soundboardTrigger.querySelector(".soundName");
    check(
      triggerLabel?.title === "Soundboard" &&
        getComputedStyle(triggerLabel).textOverflow === "ellipsis" &&
        triggerLabel.scrollWidth > triggerLabel.clientWidth,
      "Soundboard button truncates with an ellipsis and keeps a full hover title",
    );
    soundboardTrigger.style.width = "";
    check(
      panel && !document.querySelector("dialog[open]"),
      "Soundboard must be a dropup, not a modal",
    );
    const panelBounds = panel.getBoundingClientRect(),
      dockBounds = container
        .querySelector(".voiceDock")
        .getBoundingClientRect();
    check(
      Math.abs(panelBounds.width - dockBounds.width) < 3 &&
        panelBounds.bottom <= dockBounds.top,
      "Dropup must match the call footer width and sit above its controls",
    );
    check(
      !panel.textContent.includes("Stop my sound"),
      "The stop control must be removed",
    );
    const grid = panel.querySelector(".soundboardClips");
    const longName = [...grid.querySelectorAll(".soundName")].find((label) =>
      label.textContent.startsWith("A very long"),
    );
    check(
      longName &&
        longName.title === longName.textContent &&
        longName.scrollWidth > longName.clientWidth &&
        getComputedStyle(longName).textOverflow === "ellipsis",
      "Long sound names truncate with an ellipsis and expose their full hover title",
    );
    const tiles = [...grid.querySelectorAll(".soundboardClip")].map((tile) =>
      tile.getBoundingClientRect(),
    );
    check(
      tiles[0].top === tiles[1].top && tiles[2].top > tiles[0].top,
      "Soundboard must display two sounds per row",
    );
    check(
      grid.clientHeight === 208 &&
        grid.scrollHeight > grid.clientHeight &&
        getComputedStyle(grid).overflowY === "auto",
      "Exactly three sound rows must be visible with vertical scrolling",
    );
    check(
      getComputedStyle(grid).scrollbarColor ===
        getComputedStyle(document.body).scrollbarColor,
      "Soundboard must inherit the app scrollbar style",
    );
    check(
      getComputedStyle(panel.querySelector(".soundboardPlay")).textAlign ===
        "center",
      "Sound names must stay centered",
    );
    const search = panel.querySelector('[aria-label="Search sounds"]');
    const inputValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set;
    inputValue.call(search, "no such sound");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    check(
      panel.querySelectorAll(".soundboardClip").length === 0 &&
        panel.textContent.includes("No sounds match"),
      "Search must filter the displayed sounds",
    );
    inputValue.call(search, "");
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    const preview = panel.querySelector('[aria-label="Preview Celebrate"]');
    check(
      preview.querySelector("svg") &&
        !panel.querySelector(".soundboardPlay svg"),
      "Sounds must play from their centered name and use an icon Preview action",
    );
    const mute = panel
      .querySelector(".soundboardVolume > button")
      .getBoundingClientRect();
    const icon = panel
      .querySelector(".soundboardVolume svg")
      .getBoundingClientRect();
    check(
      Math.abs(mute.left + mute.width / 2 - icon.left - icon.width / 2) < 1 &&
        Math.abs(mute.top + mute.height / 2 - icon.top - icon.height / 2) < 1,
      "The mute icon must be centered horizontally and vertically",
    );
    preview.focus();
    const previewBounds = preview.getBoundingClientRect();
    const previewIcon = preview.querySelector("svg").getBoundingClientRect();
    check(
      Math.abs(
        previewBounds.left +
          previewBounds.width / 2 -
          previewIcon.left -
          previewIcon.width / 2,
      ) < 1 &&
        Math.abs(
          previewBounds.top +
            previewBounds.height / 2 -
            previewIcon.top -
            previewIcon.height / 2,
        ) < 1,
      "Preview icon must be centered in its button",
    );
    const nameButton = panel.querySelector(".soundboardPlay");
    const nameBounds = nameButton.getBoundingClientRect();
    const nameRange = document.createRange();
    nameRange.selectNodeContents(nameButton);
    const textBounds = nameRange.getBoundingClientRect();
    check(
      Math.abs(
        nameBounds.left +
          nameBounds.width / 2 -
          textBounds.left -
          textBounds.width / 2,
      ) < 1 &&
        Math.abs(
          nameBounds.top +
            nameBounds.height / 2 -
            textBounds.top -
            textBounds.height / 2,
        ) < 1,
      "Sound name must be centered horizontally and vertically",
    );
    check(
      getComputedStyle(preview.parentElement).opacity === "1",
      "Clip actions must be available on keyboard focus",
    );
    preview.click();
    for (
      let attempt = 0;
      attempt < 30 &&
      !document.querySelector('[data-lc-soundboard-local="preview"]')
        ?.srcObject;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 20));
    check(
      publications === 1 && permits === 0 && !speaking.includes(true),
      "Preview must stay local and must not announce speaking",
    );
    const previewAudio = document.querySelector(
      '[data-lc-soundboard-local="preview"]',
    );
    previewTrack = previewAudio.srcObject?.getAudioTracks()[0];
    check(
      previewTrack?.readyState === "live",
      "Preview must play through its local audio track",
    );
    panel.querySelector('[aria-label="Mute soundboard"]').click();
    await wait();
    check(previewAudio.muted, "Soundboard mute must also mute local previews");
    check(
      localStorage.getItem("lc.soundboardMuted") === "true",
      "Soundboard mute persists for reconnects",
    );
    panel.querySelector('[aria-label="Play Celebrate for everyone"]').click();
    await wait();
    const playButton = panel.querySelector(
      '[aria-label="Play Celebrate for everyone"]',
    );
    check(
      playButton.disabled && playButton.title === "One sound per second",
      "Call playback must show a one-second cooldown",
    );
    playButton.click();
    await new Promise((resolve) => setTimeout(resolve, 220));
    check(
      publications === 1 && speaking.includes(true),
      "Published sound must light speaking while the microphone is unused",
    );
    check(
      document.querySelector('[data-lc-soundboard-local="playback"]').muted,
      "Mute must silence the sender's local playback without muting publication",
    );
    check(
      !panel.querySelector('[aria-label^="Remove "]'),
      "Removal must not appear on call tiles",
    );
    panel.querySelector(".soundboardAdd").click();
    await wait();
    const uploadDialog = document.querySelector(
      "dialog.soundUploadModal[open]",
    );
    check(uploadDialog, "Adding a sound must open a separate modal");
    const fileInput = uploadDialog.querySelector('[aria-label="Sound file"]');
    const invalidSelection = new DataTransfer();
    invalidSelection.items.add(
      new File(["invalid audio"], "broken.mp3", { type: "audio/mpeg" }),
    );
    fileInput.files = invalidSelection.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    for (
      let i = 0;
      i < 50 && !uploadDialog.querySelector('[role="alert"]');
      i++
    )
      await wait();
    check(
      uploadDialog.textContent.includes("could not be decoded") &&
        uploadDialog.querySelector('button[type="submit"]').disabled,
      "Unsupported audio has a visible error and cannot upload",
    );
    const recordingContext = new AudioContext();
    const recordingOutput = recordingContext.createMediaStreamDestination();
    const oscillator = recordingContext.createOscillator();
    oscillator.connect(recordingOutput);
    const recorder = new MediaRecorder(recordingOutput.stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    try {
      await recordingContext.resume();
      oscillator.start();
      recorder.start();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
    } finally {
      oscillator.stop();
      recordingOutput.stream.getTracks().forEach((track) => track.stop());
      await recordingContext.close();
    }
    const compressedSelection = new DataTransfer();
    compressedSelection.items.add(
      new File(chunks, "recording.webm", { type: "audio/webm" }),
    );
    fileInput.files = compressedSelection.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 50 && !uploadDialog.querySelector(".soundTrim"); i++)
      await wait();
    check(
      uploadDialog.querySelector(".soundTrim"),
      "Compressed audio decodes for trimming",
    );
    await playSoundPreview(
      uploadDialog.querySelector("audio"),
      "Converted compressed sound",
    );
    check(
      uploads === 0 && publications === 1,
      "Compressed audio preview stays local before upload",
    );
    const original = soundWave("celebrate-v1");
    const longWave = new Uint8Array(44 + 12 * 24000 * 2);
    longWave.set(original.subarray(0, 44));
    new DataView(longWave.buffer).setUint32(4, longWave.length - 8, true);
    new DataView(longWave.buffer).setUint32(40, longWave.length - 44, true);
    for (let i = 44; i < longWave.length; i++)
      longWave[i] = original[44 + ((i - 44) % (original.length - 44))];
    const selection = new DataTransfer();
    selection.items.add(
      new File([longWave], "Uploaded.wav", {
        type: "audio/wav",
      }),
    );
    fileInput.files = selection.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 50 && !uploadDialog.querySelector(".soundTrim"); i++)
      await wait();
    check(
      uploadDialog.querySelector(".soundTrim"),
      "Audio loads for local trimming",
    );
    const trimStart = uploadDialog.querySelector(
      '[aria-label="Trim start seconds"]',
    );
    const trimEnd = uploadDialog.querySelector(
      '[aria-label="Trim end seconds"]',
    );
    check(
      Number(trimEnd.max) === 12,
      "Long sources are available for selection",
    );
    const endHandle = uploadDialog.querySelector(
      '[aria-label="Trim end position"]',
    );
    check(
      endHandle?.getAttribute("role") === "slider" &&
        uploadDialog.querySelector(".soundTrimTrack svg rect"),
      "Trim handles are on the waveform track",
    );
    for (const key of ["End", "Home", "End"]) {
      endHandle.focus();
      endHandle.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await wait();
      check(
        uploadDialog.querySelector("audio") &&
          !uploadDialog.querySelector('button[type="submit"]').disabled,
        "Extreme trim positions keep the preview and upload available",
      );
      check(
        Number(trimEnd.value) - Number(trimStart.value) <= 10.000001,
        "Selection stays at or below ten seconds",
      );
      endHandle.dispatchEvent(
        new KeyboardEvent("keyup", { key, bubbles: true }),
      );
      await wait();
    }
    const selectedHandle = uploadDialog.querySelector(
      '[aria-label="Move selected clip"]',
    );
    selectedHandle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Home",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    check(
      Number(trimStart.value) === 0,
      "The selected clip moves directly on the track",
    );
    const previewToggle = uploadDialog.querySelector(
      ".soundPreviewToggle input",
    );
    check(
      previewToggle.checked &&
        trimStart.value === "0.00" &&
        trimEnd.value === "10.00",
      "Preview on finish is enabled by default and times display two decimals",
    );
    check(
      uploadDialog.querySelector("audio").paused,
      "Moving a trim handle does not autoplay while moving",
    );
    selectedHandle.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Home", bubbles: true }),
    );
    for (let i = 0; i < 50 && uploadDialog.querySelector("audio").paused; i++)
      await wait();
    check(
      !uploadDialog.querySelector("audio").paused,
      "Finishing a start change previews the selected clip",
    );
    previewToggle.click();
    await wait();
    selectedHandle.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "End",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait();
    selectedHandle.dispatchEvent(
      new KeyboardEvent("keyup", { key: "End", bubbles: true }),
    );
    await wait();
    check(
      uploadDialog.querySelector("audio").paused,
      "Disabling the option prevents automatic preview",
    );
    inputValue.call(trimStart, "11");
    trimStart.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    inputValue.call(trimEnd, "11.2");
    trimEnd.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
    const selectedPreview = uploadDialog.querySelector("audio");
    await playSoundPreview(selectedPreview, "Trimmed sound");
    check(
      Math.abs(selectedPreview.duration - 0.2) < 0.01 && publications === 1,
      "Trim preview plays only the selection without publishing",
    );
    uploadDialog.querySelector('button[type="submit"]').click();
    await wait();
    check(
      uploads === 1 &&
        panel.querySelector('[aria-label="Play Uploaded for everyone"]'),
      "The upload dialog must add the returned custom sound",
    );
    const uploadedPreview = uploadDialog.querySelector("audio");
    check(
      uploadedPreview?.controls && uploadedPreview.src.startsWith("blob:"),
      "Uploaded sounds must have local preview controls",
    );
    await playSoundPreview(uploadedPreview, "Uploaded sound");
    check(publications === 1, "Upload preview must not publish to the call");
    uploadDialog.querySelector('.modalActions button[type="button"]').click();
    await wait();
    check(
      uploadedPreview.paused && !uploadedPreview.getAttribute("src"),
      "Closing the upload dialog must stop and release its preview",
    );
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await wait();
    check(
      !container.querySelector(".soundboardDropup") &&
        document.activeElement === trigger,
      "Escape must close the dropup and restore trigger focus",
    );
    const loadedFetch = window.fetch;
    let finishRefresh;
    window.fetch = (url, options) =>
      String(url) === "/api/servers/call-server/soundboard"
        ? new Promise((resolve) => {
            finishRefresh = resolve;
          })
        : loadedFetch(url, options);
    try {
      flushSync(() => trigger.click());
      check(
        container.querySelector('[aria-label="Play Celebrate for everyone"]') &&
          !container.querySelector(".loadingSkeleton"),
        "Reopening a loaded board must show its tiles immediately while metadata refreshes",
      );
      await wait();
      check(
        finishRefresh,
        "Reopening must still revalidate soundboard metadata",
      );
      finishRefresh(Response.json({ canManage: true, sounds: soundList }));
      await wait();
    } finally {
      window.fetch = loadedFetch;
    }
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await wait();
    const managerHost = document.createElement("div");
    document.body.append(managerHost);
    const managerRoot = createRoot(managerHost);
    const callAudio = document.querySelector(
      '[data-lc-soundboard-local="playback"]',
    );
    try {
      managerRoot.render(
        h(
          SettingsModal,
          {
            title: "Server settings",
            onClose() {},
            navigation: h(SettingsNavigation, {
              account: false,
              owner: true,
              selected: "soundboard",
              onSelect() {},
            }),
          },
          h(SoundManager, { serverId: "call-server" }),
        ),
      );
      await wait();
      const manager = document.querySelector(".soundManager");
      const previewButton = manager.querySelector(
        '[aria-label="Preview Uploaded"]',
      );
      const previewBounds = previewButton.getBoundingClientRect();
      const iconBounds = previewButton
        .querySelector("svg")
        .getBoundingClientRect();
      check(
        Math.abs(
          (previewBounds.left + previewBounds.right) / 2 -
            (iconBounds.left + iconBounds.right) / 2,
        ) < 1 &&
          Math.abs(
            (previewBounds.top + previewBounds.bottom) / 2 -
              (iconBounds.top + iconBounds.bottom) / 2,
          ) < 1,
        "Sound preview icon must be centered inside its button",
      );
      check(
        getComputedStyle(previewButton).backgroundColor === "rgb(34, 44, 64)",
        "Preview uses the shared neutral button style",
      );
      check(
        getComputedStyle(manager.querySelector("button.primary"))
          .backgroundColor === "rgb(120, 164, 255)",
        "Standalone Add custom sound uses the blue accent",
      );
      check(
        getComputedStyle(manager.querySelector("button.danger")).color ===
          "rgb(255, 137, 156)",
        "Sound removal uses the red danger style",
      );
      const joinSound = manager.querySelector(
        '[aria-label="Voice channel join sound"]',
      );
      check(
        joinSound &&
          joinSound.value === "" &&
          joinSound.options[0].textContent === "Default",
        "Server join sound starts at Default",
      );
      joinSound.value = "custom-test";
      joinSound.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      check(
        manager.textContent.includes("Join sound changed successfully") &&
          !manager.textContent.includes("Saving join sound"),
        "Join-sound save shows only the completed success message",
      );
      joinSound.value = "";
      joinSound.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      check(
        joinSoundChanges.join(",") === "custom-test,",
        "Server settings saves a soundboard clip and resets to Default",
      );
      check(
        !manager.querySelector('[aria-label="Voice channel leave sound"]'),
        "Custom leave sound is removed",
      );
      check(
        manager &&
          document.querySelector('.settingsNavigation [aria-current="page"]')
            .textContent === "Soundboard",
        "Server settings must expose a Soundboard section",
      );
      manager.querySelector('[aria-label="Preview Uploaded"]').click();
      await wait();
      const managedPreview = manager.querySelector("audio");
      await playSoundPreview(managedPreview, "Managed sound");
      manager.querySelector('[aria-label="Remove Uploaded"]').click();
      await wait();
      check(
        removals === 1 &&
          !manager.querySelector('[aria-label="Remove Uploaded"]'),
        "Settings must remove custom sounds",
      );
      check(
        managedPreview.paused && !managedPreview.getAttribute("src"),
        "Removing a sound must stop its management preview",
      );
      [...manager.querySelectorAll("button")]
        .find((button) => button.textContent === "Add custom sound")
        .click();
      await wait();
      const nested = document.querySelector("dialog.soundUploadModal[open]");
      check(
        nested && nested.querySelector('[aria-label="Sound file"]'),
        "Settings must reuse the upload dialog",
      );
      check(
        [...nested.querySelectorAll(".modalActions button")].every(
          (button) =>
            getComputedStyle(button).backgroundColor === "rgb(34, 44, 64)",
        ),
        "Grouped upload actions use the same neutral button style",
      );
      nested.querySelector('.modalActions button[type="button"]').click();
      await wait();
      check(
        !document.querySelector("dialog.soundUploadModal[open]") &&
          document.querySelector("dialog.settingsWorkspace[open]"),
        "Closing upload must preserve the settings modal",
      );
      check(
        callAudio.isConnected &&
          document.querySelector('[data-lc-soundboard-local="playback"]') ===
            callAudio,
        "Managing sounds must preserve the call's audio owner",
      );
      canManageSounds = false;
      managerRoot.render(
        h(SoundManager, { key: "moderator", serverId: "call-server" }),
      );
      await wait();
      const moderatorSettings = document.querySelector(".soundManager");
      check(
        [...moderatorSettings.querySelectorAll("button")].some(
          (button) => button.textContent === "Add custom sound",
        ) && !moderatorSettings.querySelector('[aria-label^="Remove "]'),
        "Moderators can upload sounds without owner removal actions",
      );
      canUploadSounds = false;
      window.dispatchEvent(
        new CustomEvent("lc-soundboard-updated", {
          detail: { serverId: "call-server" },
        }),
      );
      await wait();
      check(
        ![...moderatorSettings.querySelectorAll("button")].some(
          (button) => button.textContent === "Add custom sound",
        ),
        "Role refresh removes upload controls after demotion",
      );
      managerRoot.render(
        h(
          SettingsModal,
          {
            title: "Server settings",
            onClose() {},
            navigation: h(SettingsNavigation, {
              account: false,
              owner: false,
              selected: "join-sound",
              onSelect() {},
            }),
          },
          h(SoundManager, {
            key: "member",
            serverId: "call-server",
            joinSoundOnly: true,
          }),
        ),
      );
      await wait();
      const memberSettings = document.querySelector(".soundManager");
      const memberChoice = memberSettings.querySelector(
        '[aria-label="Voice channel join sound"]',
      );
      check(
        memberChoice &&
          !memberSettings.querySelector(
            "button, .soundboardSearch, .soundManagerList",
          ),
        "Members can choose the join sound without soundboard management actions",
      );
      memberChoice.value = "celebrate-v1";
      memberChoice.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      check(
        joinSoundChanges.at(-1) === "celebrate-v1",
        "Members save their personal server join-sound choice",
      );
    } finally {
      managerRoot.unmount();
      managerHost.remove();
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const beforeJoin = permits;
    await boardActions.playJoinSound("arriving-user", publish);
    check(
      permits === beforeJoin + 1 &&
        publications === 1 &&
        publishedTrack.readyState === "live",
      "Automatic join must publish through the same live soundboard track path",
    );
  } finally {
    root.unmount();
    container.remove();
    window.fetch = originalFetch;
    for (const [key, value] of savedPreferences) {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    }
  }
  check(
    previewTrack.readyState === "ended" &&
      publishedTrack.readyState === "ended",
    "Leaving must stop local and published sound tracks",
  );
  return { startupLatency };
}
window.verifySoundboard = verifySoundboard;

async function verifyLiveKitImmediateMute() {
  const context = new AudioContext();
  await context.resume();
  const tone = context.createOscillator();
  const destination = context.createMediaStreamDestination();
  tone.connect(destination);
  tone.start();
  const track = new RemoteAudioTrack(
    destination.stream.getAudioTracks()[0],
    "test-audio",
    {},
    context,
  );
  const audio = document.createElement("audio");
  document.body.append(audio);
  try {
    applyRemoteAudioVolume(track, 0);
    track.attach(audio);
    const analyser = context.createAnalyser();
    track.setWebAudioPlugins([analyser]);
    const values = new Float32Array(analyser.fftSize);
    await new Promise((resolve) => setTimeout(resolve, 45));
    analyser.getFloatTimeDomainData(values);
    check(
      values.every((value) => Math.abs(value) < 0.0001),
      "A newly attached muted LiveKit clip must be silent before its gain fade completes",
    );
    applyRemoteAudioVolume(track, 0.4);
    await new Promise((resolve) => setTimeout(resolve, 80));
    analyser.getFloatTimeDomainData(values);
    check(
      values.some((value) => Math.abs(value) > 0.01),
      "Unmuting must restore audio on the same track",
    );
    applyRemoteAudioVolume(track, 0);
    check(
      !track.mediaStreamTrack.enabled,
      "Muting an attached track must close the receiver gate immediately",
    );
  } finally {
    track.detach(audio);
    track.stop();
    audio.remove();
    tone.stop();
    await context.close();
  }
}
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
async function verifyScreenAudioTransport() {
  const context = new AudioContext();
  const microphone = context.createMediaStreamDestination();
  const shared = context.createMediaStreamDestination();
  const soundboard = context.createMediaStreamDestination();
  const voiceTone = context.createOscillator();
  const streamTone = context.createOscillator();
  const soundTone = context.createOscillator();
  soundTone.connect(soundboard);
  soundTone.start();
  voiceTone.connect(microphone);
  streamTone.connect(shared);
  voiceTone.start();
  streamTone.start();
  const first = new RTCPeerConnection();
  const second = new RTCPeerConnection();
  first.onicecandidate = (event) => {
    if (event.candidate) void second.addIceCandidate(event.candidate);
  };
  second.onicecandidate = (event) => {
    if (event.candidate) void first.addIceCandidate(event.candidate);
  };
  try {
    await context.resume();
    first.addTrack(microphone.stream.getAudioTracks()[0]);
    const outgoingScreen = reserveScreenAudio(first, null, context);
    const outgoingSound = reserveScreenAudio(first, null, context);
    const silentMicrophone = reserveScreenAudio(second, null, context);
    const incomingScreen = reserveScreenAudio(second, null, context);
    const incomingSound = reserveScreenAudio(second, null, context);
    let receivedScreen = null;
    second.ontrack = (event) => {
      if (event.transceiver === incomingScreen.transceiver)
        receivedScreen = event.track;
    };
    await first.setLocalDescription(await first.createOffer());
    await second.setRemoteDescription(first.localDescription);
    await second.setLocalDescription(await second.createAnswer());
    await first.setRemoteDescription(second.localDescription);
    await outgoingScreen.sender.replaceTrack(shared.stream.getAudioTracks()[0]);
    microphone.stream.getAudioTracks()[0].enabled = false;
    await outgoingSound.sender.replaceTrack(
      soundboard.stream.getAudioTracks()[0],
    );
    let delivered = false;
    for (let attempt = 0; attempt < 30 && !delivered; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const stats = await incomingScreen.receiver.getStats();
      stats.forEach((stat) => {
        if (stat.type === "inbound-rtp" && stat.bytesReceived > 0)
          delivered = true;
      });
    }
    check(
      delivered && receivedScreen === incomingScreen.receiver.track,
      "Reserved screen audio must deliver RTP on its own receiving track",
    );
    check(
      second
        .getReceivers()
        .filter((receiver) => receiver.track.kind === "audio").length === 3,
      "Soundboard, screen and microphone must have distinct audio tracks",
    );
    let soundDelivered = false;
    const playback = document.createElement("audio");
    playback.srcObject = new MediaStream([incomingSound.receiver.track]);
    document.body.append(playback);
    await playback.play();
    const receivedSound = context.createMediaStreamSource(
      new MediaStream([incomingSound.receiver.track]),
    );
    const analyser = context.createAnalyser();
    const silentOutput = context.createGain();
    silentOutput.gain.value = 0;
    receivedSound.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(context.destination);
    const samples = new Float32Array(analyser.fftSize);
    for (let attempt = 0; attempt < 30 && !soundDelivered; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      analyser.getFloatTimeDomainData(samples);
      soundDelivered = samples.some((value) => Math.abs(value) > 0.001);
    }
    check(
      soundDelivered,
      "Soundboard must deliver audible audio while microphone is muted",
    );
    receivedSound.disconnect();
    analyser.disconnect();
    silentOutput.disconnect();
    playback.pause();
    playback.srcObject = null;
    playback.remove();
    await outgoingSound.sender.replaceTrack(null);
    check(
      outgoingScreen.sender.track === shared.stream.getAudioTracks()[0],
      "Stopping soundboard must retain screen audio",
    );
    await outgoingScreen.sender.replaceTrack(null);
    check(
      first.getSenders()[0].track === microphone.stream.getAudioTracks()[0],
      "Stopping screen audio must retain the microphone",
    );
    outgoingScreen.stop();
    incomingScreen.stop();
    silentMicrophone.stop();
    outgoingSound.stop();
    incomingSound.stop();
  } finally {
    first.getSenders().forEach((sender) => sender.track?.stop());
    second.getSenders().forEach((sender) => sender.track?.stop());
    shared.stream.getTracks().forEach((track) => track.stop());
    soundboard.stream.getTracks().forEach((track) => track.stop());
    first.close();
    second.close();
    voiceTone.stop();
    streamTone.stop();
    soundTone.stop();
    await context.close();
  }
}
window.verifyScreenAudioTransport = verifyScreenAudioTransport;
window.verifyLiveKitImmediateMute = verifyLiveKitImmediateMute;

window.verifyVideoFullscreen = async () => {
  const container = document.createElement("div");
  container.className = "videoGrid focused";
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    h(
      React.Fragment,
      null,
      h("div", { className: "videoCard videoHidden" }, h("video")),
      h(
        "div",
        { className: "videoCard remote" },
        h("video"),
        h("span", null, "Sender"),
        h("button", { className: "tileHide" }, "Hide"),
        h(StreamInfo, {
          name: "Sender — screen",
          quality: "3840×2160",
          stats: "down 8000 kbps · 30 fps · 12 ms ping",
        }),
        h(StreamVolume, {
          volume: 50,
          onChange: (value) => {
            window.testStreamVolume = value;
          },
        }),
      ),
      h("div", { className: "focusActions" }, "Grid controls"),
      h("button", { className: "selfViewToggle" }, "Show yourself"),
      h(
        "details",
        { className: "hiddenTilesMenu" },
        h("summary", null, "Hidden windows"),
      ),
    ),
  );
  await wait();
  const tile = container.querySelector(".videoCard.remote");
  check(
    getComputedStyle(container.querySelector(".hiddenTilesMenu")).display ===
      "none",
    "Focused media must hide the Hidden windows menu",
  );
  check(
    getComputedStyle(container.querySelector(".selfViewToggle")).display ===
      "none",
    "Focused media must hide Show yourself",
  );
  const summary = tile.querySelector(".streamSummary");
  check(
    summary.querySelector(".networkBadge").getBoundingClientRect().top >
      summary.querySelector(".qualityBadge").getBoundingClientRect().bottom,
    "Stream statistics must sit below the full resolution",
  );
  check(
    directionalStreamStats(
      "up 100 kbps · 20 fps · down 200 kbps · 30 fps · 12 ms ping",
      "down",
    ) === "down 200 kbps · 30 fps · 12 ms ping",
    "Remote statistics must use download traffic and its own FPS",
  );
  await fullscreenVideoTile(container);
  check(
    document.fullscreenElement === tile,
    "Fullscreen must target only the selected video tile",
  );
  check(
    getComputedStyle(tile.querySelector("video")).objectFit === "contain",
    "Fullscreen must preserve the entire video",
  );
  check(
    getComputedStyle(summary).display === "none" &&
      getComputedStyle(tile.querySelector("span")).display === "none" &&
      getComputedStyle(tile.querySelector(".tileHide")).display === "none",
    "Fullscreen must hide names, badges and tile controls",
  );
  const trigger = tile.querySelector(".streamInfoTrigger");
  check(
    getComputedStyle(trigger).display !== "none",
    "Fullscreen must retain the information icon",
  );
  trigger.focus();
  check(
    getComputedStyle(tile.querySelector('[role="tooltip"]')).display === "grid",
    "Focusing the info icon must reveal stream details",
  );
  const exit = tile.querySelector('[aria-label="Exit fullscreen"]');
  check(
    getComputedStyle(exit).display !== "none",
    "Fullscreen must expose its exit button",
  );
  exit.click();
  await wait();
  check(!document.fullscreenElement, "The exit button closes fullscreen");
  await fullscreenVideoTile(container);
  await fullscreenVideoTile(tile);
  check(
    !document.fullscreenElement,
    "Double-click fullscreen helper closes fullscreen",
  );
  const volumeButton = tile.querySelector(".streamVolume button");
  volumeButton.focus();
  check(
    getComputedStyle(tile.querySelector(".streamVolume label")).display ===
      "block",
    "Stream volume slider must reveal on focus",
  );
  volumeButton.click();
  check(
    window.testStreamVolume === 0,
    "Stream mute must affect only its volume callback",
  );
  root.unmount();
  container.remove();
  return {
    selectedTileOnly: true,
    fullResolution: true,
    fullscreenInformation: true,
  };
};
function verifyWorkspaceHeaderLayout() {
  const probe = document.createElement("div");
  probe.className = "workspace";
  probe.style.cssText =
    "position:fixed;inset:0;z-index:1000;pointer-events:none";
  probe.innerHTML = `<aside class="workspaceRail"></aside><aside class="channelSidebar"><header class="workspaceName"><strong>Test server</strong><button class="serverInviteButton">+</button><div class="serverActions"><button class="accountMenuTrigger">Cog</button></div></header></aside><section class="room"><header class="roomHeader"><nav class="panelControls"><button>Servers</button><button>Channels</button><button>Users</button></nav><strong>General</strong><div class="conversationSearch"><form><input placeholder="Search messages"/><button>Search</button></form></div></header><section class="chat"><form><input/><button data-chat-send>Send</button></form></section></section>`;
  document.body.append(probe);
  const channel = probe
    .querySelector(".panelControls > button:nth-child(2)")
    .getBoundingClientRect();
  const invite = probe
    .querySelector(".serverInviteButton")
    .getBoundingClientRect();
  const settings = probe
    .querySelector(".serverActions button")
    .getBoundingClientRect();
  check(
    channel.right < invite.left && invite.right < settings.left,
    "Invite must sit between hide channels and server settings without overlap",
  );
  const menu = probe
    .querySelector(".conversationSearch")
    .getBoundingClientRect();
  const send = probe.querySelector("[data-chat-send]").getBoundingClientRect();
  check(
    innerWidth <= 920 || Math.abs(menu.right - send.right) < 2,
    `Search and Send must share the same right margin (search ${menu.right}, send ${send.right})`,
  );
  const users = probe
    .querySelector(".panelControls > button:nth-child(3)")
    .getBoundingClientRect();
  check(
    Math.abs(users.right - (innerWidth - 12)) < 2 &&
      (menu.right <= users.left || users.bottom <= menu.top),
    "User-list toggle must not overlap search",
  );
  probe.classList.add("friendsScreen");
  probe.querySelector(".serverInviteButton").remove();
  const messages = probe
    .querySelector(".panelControls > button:nth-child(2)")
    .getBoundingClientRect();
  check(
    Math.abs(messages.left - settings.left) < 2,
    "Friends messages toggle must occupy the server-settings position",
  );
  probe.remove();
}
window.verifyWorkspaceAdditions = async () => {
  await verifyPrivacyManagement();
  await verifySettingsCategories();
  await verifyInvitesAndReveal();
  await verifyPanelToggleStates();
  await verifyParticipantIndicators();
  await verifyScreenShareOptions();
  verifyWorkspaceHeaderLayout();
};
async function verifyPrivacyManagement() {
  const container = document.createElement("div");
  container.className = "settingsContent";
  container.style.cssText =
    "position:fixed;inset:0;z-index:1000;background:#151925;overflow:auto";
  document.body.append(container);
  const root = createRoot(container),
    originalFetch = window.fetch;
  const rows = [
    {
      id: "s1",
      text: "needle message",
      createdAt: "2026-11-03T10:00:00Z",
      deletedAt: null,
      kind: "server",
      groupId: "server",
      groupName: "Test server",
      channelName: "general",
    },
    {
      id: "s2",
      text: "another message",
      createdAt: "2026-11-03T11:00:00Z",
      deletedAt: null,
      kind: "server",
      groupId: "server",
      groupName: "Test server",
      channelName: "general",
    },
    {
      id: "d1",
      text: "direct message",
      createdAt: "2026-11-03T12:00:00Z",
      deletedAt: null,
      kind: "direct",
      groupId: "person",
      groupName: "Bob",
    },
  ];
  const deletions = [];
  let accountDeleted = false;
  window.fetch = async (url, options) => {
    if (String(url) === "/api/users/me/message-history") {
      if (options?.method === "DELETE") {
        const body = JSON.parse(options.body);
        deletions.push(body);
        return Response.json({ deletedIds: [body.messageId] });
      }
      return Response.json(rows);
    }
    if (String(url) === "/api/users/me" && options?.method === "DELETE") {
      deletions.push(JSON.parse(options.body));
      return Response.json({ deleted: true });
    }
    return originalFetch(url, options);
  };
  const type = async (input, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
  };
  try {
    const cache = new SessionCache();
    cache.scope("fixture-user");
    root.render(
      h(PersonalMessages, {
        currentServerId: "server",
        accountId: "fixture-user",
        cache,
      }),
    );
    await wait();
    check(
      container.querySelectorAll(".messageDestinationList button").length ===
        1 && !container.querySelector("article"),
      "My messages must initially show server destinations",
    );
    container.querySelector(".messageDestinationList button").click();
    await wait();
    const dialog = document.querySelector("dialog[open]");
    check(
      dialog && dialog.querySelectorAll("article").length === 2,
      "Opening a server must show its messages in a new window",
    );
    const cards = [...dialog.querySelectorAll("article")].map((card) =>
      card.getBoundingClientRect(),
    );
    const reference = document.createElement("dialog");
    reference.className = "settingsModal settingsWorkspace";
    document.body.append(reference);
    reference.showModal();
    const expected = reference.getBoundingClientRect();
    reference.close();
    reference.remove();
    check(
      Math.abs(dialog.getBoundingClientRect().width - expected.width) < 2 &&
        Math.abs(dialog.getBoundingClientRect().height - expected.height) < 2,
      "Message window does not match the User settings dimensions",
    );
    check(
      innerWidth > 650
        ? cards[1].left > cards[0].right &&
            Math.abs(cards[1].top - cards[0].top) < 1
        : cards[1].top > cards[0].bottom,
      "Message cards did not use two desktop columns and one mobile column",
    );
    check(
      getComputedStyle(dialog.querySelector("article p")).whiteSpace ===
        "pre-wrap",
      "Message text wrapping changed",
    );
    await type(dialog.querySelector('input[type="search"]'), "needle");
    check(
      dialog.querySelectorAll("article").length === 1,
      "Message search must filter only the selected destination",
    );
    dialog.querySelector("article .messageBulkDelete > button").click();
    await wait();
    dialog.querySelector("article .settingsDangerZone button.danger").click();
    await wait();
    check(
      deletions[0].messageId === "s1" && deletions[0].groupId === "server",
      "Message deletion must target the selected row and server",
    );
    dialog.querySelector(".settingsClose").click();
    await wait();
    [...container.querySelectorAll(".settingsDestinations button")]
      .find((button) => button.textContent === "People")
      .click();
    await wait();
    await type(container.querySelector('input[type="search"]'), "Bob");
    check(
      container.querySelectorAll(".messageDestinationList button").length === 1,
      "Destination search must filter servers and people",
    );
    root.render(
      h(AccountDeletion, {
        onDeleted: () => {
          accountDeleted = true;
        },
      }),
    );
    await wait();
    container.querySelector("button.danger").click();
    await wait();
    const checkbox = container.querySelector('input[type="checkbox"]');
    check(
      !checkbox.checked &&
        container.querySelectorAll("button.danger")[0].disabled,
      "Account deletion must require explicit confirmation and default to retaining messages",
    );
    checkbox.click();
    await type(
      container.querySelector('input:not([type="checkbox"])'),
      "DELETE",
    );
    container.querySelector("button.danger").click();
    await wait();
    check(
      accountDeleted &&
        deletions.at(-1).deleteMessages === true &&
        deletions.at(-1).confirm === "DELETE",
      "Account deletion must send the chosen message-retention option",
    );
    root.render(
      h(SettingsMembers, {
        members: [
          { id: "a", name: "Alice", role: "member" },
          { id: "b", name: "Bob", role: "member" },
        ],
        onTransfer: async (member) => {
          window.testTransferredOwner = member.id;
        },
      }),
    );
    await wait();
    const memberRows = [...container.querySelectorAll(".settingsMemberRow")];
    check(
      getComputedStyle(memberRows[0]).backgroundColor !==
        getComputedStyle(memberRows[1]).backgroundColor,
      "Member rows must alternate colors",
    );
    await type(container.querySelector('input[type="search"]'), "Bob");
    check(
      container.querySelectorAll(".settingsMemberRow").length === 1,
      "Member search must filter the settings list",
    );
    container.querySelector(".transferOwnershipButton").click();
    await wait();
    check(
      !window.testTransferredOwner &&
        container
          .querySelector(".ownershipConfirmation")
          .textContent.includes("lose owner controls"),
      "Promoting a member must require a clear ownership-transfer confirmation",
    );
    container.querySelector(".ownershipConfirmation button.danger").click();
    await wait();
    check(
      window.testTransferredOwner === "b",
      "Ownership transfer must target the selected member",
    );
    delete window.testTransferredOwner;
  } finally {
    root.unmount();
    container.remove();
    window.fetch = originalFetch;
  }
}
async function verifySettingsCategories() {
  const container = document.createElement("nav");
  container.className = "settingsNavigation";
  container.style.cssText = "position:fixed;inset:0;z-index:1000";
  document.body.append(container);
  const root = createRoot(container);
  let selected;
  root.render(
    h(SettingsNavigation, {
      account: false,
      owner: true,
      selected: "invite-friends",
      onSelect: (id) => {
        selected = id;
      },
    }),
  );
  await wait();
  const group = container.querySelector('[aria-label="Invitations"]');
  check(
    [...group.querySelectorAll("button")]
      .map((button) => button.textContent)
      .join(",") === "Invite friends,Invite people",
    "Invitations must group friends before people",
  );
  group.querySelectorAll("button")[1].click();
  check(
    selected === "invite-people",
    "Categorized navigation must retain section actions",
  );
  check(
    container.querySelectorAll(".settingsNavCategory").length === 4,
    "Server navigation must have visible categories",
  );
  root.render(
    h(SettingsNavigation, {
      account: false,
      owner: false,
      selected: "join-sound",
      onSelect() {},
    }),
  );
  await wait();
  check(
    container.querySelectorAll("button").length === 1 &&
      container.querySelector("button").textContent === "Voice channel sounds",
    "Member server settings must expose only the join-sound section",
  );
  root.render(
    h(SettingsNavigation, {
      account: true,
      selected: "media",
      onSelect: (id) => {
        selected = id;
      },
    }),
  );
  await wait();
  check(
    [...container.querySelectorAll(".settingsNavCategory")]
      .map((node) => node.textContent)
      .join(",") === "Account,Communication,Privacy,Session",
    "User settings must group account, communication, privacy and session actions",
  );
  root.unmount();
  container.remove();
}
async function verifyInvitesAndReveal() {
  const container = document.createElement("div");
  container.className = "settingsContent";
  container.style.cssText =
    "position:fixed;inset:0;z-index:1000;background:#151925;overflow:auto";
  document.body.append(container);
  const root = createRoot(container);
  const originalFetch = window.fetch;
  const searches = [],
    invitations = [],
    added = [];
  window.fetch = async (url, options) => {
    if (String(url).includes("/servers/invite-test/invitees")) {
      searches.push(url);
      return Response.json([
        { id: "person", name: "Alex", handle: "alex.1234" },
      ]);
    }
    if (String(url).endsWith("/servers/invite-test/members")) {
      const body = JSON.parse(options.body);
      invitations.push(body);
      return Response.json({ invited: body.userIds });
    }
    return originalFetch(url, options);
  };
  const people = [
    { id: "z", name: "Zoe", status: "accepted" },
    { id: "a", name: "Alice", status: "accepted" },
    { id: "b", name: "bob", status: "accepted" },
  ];
  const type = async (value) => {
    const input = container.querySelector('input[type="search"]');
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await wait();
  };
  try {
    root.render(
      h(ServerInvites, {
        key: "friends",
        serverId: "invite-test",
        mode: "friends",
        friends: people,
        memberIds: ["z"],
        onSent: () => added.push(true),
      }),
    );
    await wait();
    check(
      [...container.querySelectorAll(".friendPickerRow b")]
        .map((node) => node.textContent)
        .join(",") === "Alice,bob,Zoe",
      "Friends must be listed alphabetically before searching",
    );
    const row = container.querySelector(".friendPickerRow");
    const checkbox = row.querySelector("input").getBoundingClientRect();
    const avatar = row.querySelector(".inviteAvatar").getBoundingClientRect();
    const identity = row
      .querySelector(".invitePersonIdentity")
      .getBoundingClientRect();
    check(
      getComputedStyle(row).display === "grid" &&
        checkbox.right < avatar.left &&
        avatar.right < identity.left,
      "Invite rows must align the checkbox, avatar and identity horizontally inside settings",
    );
    check(
      Math.abs(
        checkbox.top + checkbox.height / 2 - avatar.top - avatar.height / 2,
      ) < 2,
      "Invite checkboxes must center beside the avatar",
    );
    check(
      container.querySelectorAll('input[type="checkbox"]')[2].disabled,
      "Existing members must be marked and unavailable for reinviting",
    );
    await type("ali");
    check(
      container.querySelectorAll(".friendPickerRow").length === 1,
      "Friend search must filter the alphabetical list",
    );
    container.querySelector('input[type="checkbox"]').click();
    await wait();
    container.querySelector("button.primary").click();
    await wait();
    check(
      invitations[0].mode === "friends" &&
        added[0] === true &&
        container.textContent.includes(
          "Recipients can accept in Pending invites",
        ),
      "Friend invitations must use the friend-only API mode",
    );
    root.render(
      h(ServerInvites, {
        key: "people",
        serverId: "invite-test",
        mode: "people",
        friends: people,
        memberIds: [],
        onSent: () => added.push(true),
      }),
    );
    await wait();
    check(
      !container.querySelector(".friendPickerRow") && searches.length === 0,
      "Invite people must require a search before listing accounts",
    );
    await type("al");
    await new Promise((resolve) => setTimeout(resolve, 300));
    check(
      searches.length === 0,
      "Remote people searches must wait for three characters",
    );
    await type("ale");
    await new Promise((resolve) => setTimeout(resolve, 300));
    check(
      searches.length === 1 &&
        container.querySelector(".friendPickerRow b").textContent === "Alex",
      "People search must show matching accounts",
    );
    container.querySelector('input[type="checkbox"]').click();
    await wait();
    container.querySelector("button.primary").click();
    await wait();
    check(
      invitations[1].mode === "people",
      "People invitations must use explicit people mode",
    );
    root.unmount();
    container.innerHTML =
      '<div class="settingsContent" style="height:240px;overflow:auto;padding:20px"><div style="height:400px"></div><section id="opened-test"><button>Stop camera test</button><div style="height:300px"></div></section><div style="height:400px"></div></div>';
    const pane = container.querySelector(".settingsContent"),
      section = container.querySelector("section");
    pane.scrollTop = 180;
    const background = document.scrollingElement.scrollTop;
    revealSettingsSection(section);
    check(
      Math.abs(
        section.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          20,
      ) < 2,
      "New settings content must align toward the top of its own scroll pane",
    );
    check(
      document.scrollingElement.scrollTop === background,
      "Revealing settings must not scroll the background workspace",
    );
  } finally {
    window.fetch = originalFetch;
    container.remove();
  }
}
async function verifyPanelToggleStates() {
  const container = document.createElement("nav");
  container.className = "panelControls";
  document.body.append(container);
  const root = createRoot(container);
  function ToggleCase({ label, breakpoint }) {
    const [toggled, setToggled] = useState(false);
    return h(
      PanelToggle,
      {
        label,
        toggled,
        defaultHiddenBelow: breakpoint,
        onToggle: () => setToggled((value) => !value),
      },
      "Icon",
    );
  }
  const cases = [
    ["servers", 650],
    ["channels", 0],
    ["messages", 0],
    ["users", 920],
    ["profile", 920],
  ];
  root.render(
    cases.map(([label, breakpoint]) =>
      h(ToggleCase, { key: label, label, breakpoint }),
    ),
  );
  await wait();
  for (const [index, [label, breakpoint]] of cases.entries()) {
    const button = container.children[index];
    const open = !matchMedia(`(max-width: ${breakpoint}px)`).matches;
    check(
      button.title === `${open ? "Hide" : "Show"} ${label}` &&
        button.getAttribute("aria-label") === button.title &&
        button.getAttribute("aria-expanded") === String(open),
      "Panel action labels must reflect actual desktop/mobile visibility",
    );
    const background = getComputedStyle(button).backgroundColor;
    const borderStyle = getComputedStyle(button).borderStyle;
    button.click();
    await wait();
    check(
      button.title === `${open ? "Show" : "Hide"} ${label}` &&
        button.getAttribute("aria-expanded") === String(!open),
      "Panel action must reverse after toggling",
    );
    check(
      getComputedStyle(button).backgroundColor !== background ||
        getComputedStyle(button).borderStyle !== borderStyle,
      "Open and closed panel buttons must have different styling",
    );
  }
  root.unmount();
  container.remove();
}
async function verifyParticipantIndicators() {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;top:60px;left:10px;z-index:1000";
  document.body.append(container);
  const root = createRoot(container);
  let camera = 0,
    screen = 0;
  const participant = {
    name: "Test",
    muted: false,
    deafened: false,
    camera: true,
    screen: true,
  };
  root.render(
    h(ParticipantMediaIndicators, {
      participant,
      selfState: { muted: true, deafened: true },
      onCamera: () => camera++,
      onWatch: () => screen++,
    }),
  );
  await wait();
  check(
    container.querySelector('[aria-label="Deafened"]'),
    "Own deafen indicator must show immediately even when signaling says false",
  );
  const controls = [...container.querySelector(".voiceIndicators").children];
  check(
    controls.length === 4,
    "Deafen, microphone, camera and Watch must all appear",
  );
  const reference = getComputedStyle(controls[0]);
  const center =
    controls[0].getBoundingClientRect().top +
    controls[0].getBoundingClientRect().height / 2;
  controls.forEach((control) => {
    const css = getComputedStyle(control),
      box = control.getBoundingClientRect();
    check(
      css.borderStyle === "solid" &&
        css.borderWidth === "1px" &&
        css.backgroundColor === reference.backgroundColor &&
        css.borderRadius === reference.borderRadius &&
        box.height === 24 &&
        Math.abs(box.top + box.height / 2 - center) < 1,
      "All participant indicators must share the same centered, bordered style",
    );
  });
  container.querySelector('[aria-label="Open Test\'s camera"]').click();
  const preview = container.querySelector(
    '[aria-label="Preview your shared screen"]',
  );
  check(
    preview?.textContent === "Preview",
    "Your own shared screen must say Preview",
  );
  preview.click();
  check(
    camera === 1 && screen === 1,
    "Matching styles must preserve camera and Watch actions",
  );
  root.render(
    h(ParticipantMediaIndicators, {
      participant: { ...participant, deafened: true, muted: true },
      selfState: { muted: false, deafened: false },
      onCamera() {},
      onWatch() {},
    }),
  );
  await wait();
  check(
    !container.querySelector('[aria-label="Deafened"]') &&
      !container.querySelector('[aria-label="Muted"]'),
    "Own undeafen must clear indicators even before the signaling echo catches up",
  );
  for (const selfState of [undefined, { muted: false, deafened: false }]) {
    flushSync(() =>
      root.render(
        h(ParticipantMediaIndicators, {
          participant,
          selfState,
          serverPolicy: { voiceMuted: false, voiceDeafened: true },
          onCamera() {},
          onWatch() {},
        }),
      ),
    );
    check(
      container.querySelector('[aria-label="Server deafened"]') &&
        container.querySelector('[aria-label="Server muted"]') &&
        !container.querySelector('[aria-label="Deafened"]') &&
        !container.querySelector('[aria-label="Muted"]'),
      "Server policy overrides self-undeafen reports for owners and the affected user",
    );
    check(
      [...container.querySelectorAll(".serverModerated")].every(
        (icon) => getComputedStyle(icon).color === "rgb(255, 130, 151)",
      ),
      "Server status icons use red",
    );
  }
  const name =
    "A very long participant name that must not overlap the audio controls";
  flushSync(() =>
    root.render(
      h(
        "span",
        { className: "voiceParticipant", style: { width: "260px" } },
        h(
          "button",
          { className: "voiceParticipantIdentity" },
          h(Avatar, { name, small: true }),
          h("b", { title: name }, name),
        ),
        h(
          "span",
          { className: "voiceParticipantControls" },
          h(LocallyMuted, { muted: true, deafened: true }),
          h(ParticipantMediaIndicators, {
            participant: { ...participant, name, muted: true, deafened: true },
            onCamera() {},
            onWatch() {},
          }),
        ),
      ),
    ),
  );
  const row = container.querySelector(".voiceParticipant"),
    label = row.querySelector("b"),
    icons = row.querySelector(".localAudioIndicators");
  check(
    label.title === name &&
      label.scrollWidth > label.clientWidth &&
      getComputedStyle(label).textOverflow === "ellipsis" &&
      row.scrollWidth <= row.clientWidth + 1,
    "Crowded participant names truncate with a full-name hover title and no overlapping icons",
  );
  const centers = [...icons.children].map((icon) => {
    const box = icon.getBoundingClientRect();
    return box.top + box.height / 2;
  });
  check(
    centers.length === 2 && Math.abs(centers[0] - centers[1]) < 1,
    "Personal mute/deafen icons share one centered row",
  );
  for (const width of [150, 200, 240, 320]) {
    row.style.width = `${width}px`;
    const avatar = row.querySelector(".userAvatar").getBoundingClientRect();
    const text = label.getBoundingClientRect();
    check(
      Math.abs(text.left - avatar.right - 4) < 1 &&
        row.scrollWidth <= row.clientWidth + 1,
      "Voice identity stays compact while icon groups fit narrow sidebars",
    );
    const boxes = [
      ...row.querySelectorAll(
        ".localAudioIndicators > span, .voiceIndicators > *",
      ),
    ].map((icon) => icon.getBoundingClientRect());
    for (let a = 0; a < boxes.length; a++)
      for (let b = a + 1; b < boxes.length; b++) {
        const first = boxes[a],
          second = boxes[b];
        check(
          Math.min(first.right, second.right) <=
            Math.max(first.left, second.left) + 1 ||
            Math.min(first.bottom, second.bottom) <=
              Math.max(first.top, second.top) + 1,
          "Participant icons never overlap",
        );
      }
  }
  for (const status of ["online", "away", "dnd", "offline"]) {
    flushSync(() =>
      root.render(
        h(
          "button",
          { className: "member", style: { width: "240px" } },
          h(StatusAvatar, { name, status }),
          h("span", { className: "memberIdentity" }, h("strong", {}, name)),
        ),
      ),
    );
    const dot = container.querySelector(".statusDot"),
      picture = container.querySelector(".userAvatar");
    check(
      dot.getAttribute("aria-label") &&
        getComputedStyle(dot).backgroundColor !== "rgba(0, 0, 0, 0)" &&
        dot.getBoundingClientRect().right >=
          picture.getBoundingClientRect().right,
      "Every All users status stays visible beside the avatar",
    );
  }
  flushSync(() =>
    root.render(
      h(
        "div",
        { className: "voiceChannel", style: { width: "200px" } },
        h(
          "button",
          { className: "channel" },
          h("span", { className: "channelName" }, name),
        ),
        h("button", { className: "openCallView" }, "▣"),
      ),
    ),
  );
  check(
    container.querySelector(".channelName").getBoundingClientRect().right <
      container.querySelector(".openCallView").getBoundingClientRect().left,
    "Long channel names reserve space for their video shortcut",
  );
  root.unmount();
  container.remove();
}
async function verifyScreenShareOptions() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const shared = [];
  let canceled = false;
  root.render(
    h(ScreenShareOptions, {
      onShare: (value, fps) => shared.push([value, fps]),
      onClose: () => {
        canceled = true;
      },
    }),
  );
  await wait();
  const dialog = document.querySelector("dialog[open]");
  const select = dialog.querySelector("select");
  const heading = dialog
    .querySelector(".resolutionLabel")
    .getBoundingClientRect();
  const help = dialog.querySelector(".resolutionHelp").getBoundingClientRect();
  check(
    help.top >= heading.top &&
      help.bottom <= heading.bottom &&
      help.left > heading.left + 40,
    "Resolution help must remain inline beside its label",
  );
  check(
    select.value === "1080" && select.options.length === 4,
    "Screen sharing must offer four resolutions and default to 1080p",
  );
  check(shared.length === 0, "Opening screen options must not start capture");
  const fpsSelect = dialog.querySelector('[aria-label="Screen frame rate"]');
  check(fpsSelect.value === "30", "Screen capture defaults to 30 fps");
  fpsSelect.value = "60";
  fpsSelect.dispatchEvent(new Event("change", { bubbles: true }));
  select.value = "720";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await wait();
  dialog.querySelector('button[type="submit"]').click();
  check(
    shared[0][0] === "720" && shared[0][1] === 60,
    "Screen sharing must use the chosen resolution and 60 fps",
  );
  [...dialog.querySelectorAll('button[type="button"]')]
    .find((button) => button.textContent === "Cancel")
    .click();
  check(
    canceled,
    "Cancel must dismiss screen options without starting capture",
  );
  root.render(
    h(EmptyState, {
      title: "No pending invites",
      description: "Friend requests will appear here.",
    }),
  );
  await wait();
  check(
    container.querySelector(".contentEmptyState strong").textContent ===
      "No pending invites",
    "Empty states must show explanatory content",
  );
  let resolution;
  let cameraFps;
  root.render(
    h(CameraResolutionSelection, {
      resolution: "720",
      frameRate: 30,
      onFrameRateChange: (value) => {
        cameraFps = value;
      },
      onChange: (value) => {
        resolution = value;
      },
    }),
  );
  await wait();
  const cameraSelect = container.querySelector("select");
  const cameraFpsSelect = container.querySelector(
    '[aria-label="Camera frame rate"]',
  );
  cameraFpsSelect.value = "60";
  cameraFpsSelect.dispatchEvent(new Event("change", { bubbles: true }));
  check(cameraFps === 60, "Camera menus expose a 60 fps choice");
  cameraSelect.value = "1080";
  cameraSelect.dispatchEvent(new Event("change", { bubbles: true }));
  check(
    resolution === "1080",
    "Camera resolution selector must pass the selected quality",
  );
  const constraints = cameraCaptureConstraints(
    "camera-id",
    resolution,
    cameraFps,
  );
  check(
    constraints.width.max === 1920 &&
      constraints.height.max === 1080 &&
      constraints.deviceId.exact === "camera-id" &&
      constraints.frameRate.ideal === 60 &&
      constraints.frameRate.max === 60,
    "Camera capture must use the chosen resolution and device",
  );
  root.unmount();
  container.remove();
}
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
  const [membersWidth, setMembersWidth] = useState(null);
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
      style: {
        "--preferred-sidebar-width": width ? `${width}px` : undefined,
        "--preferred-member-width": membersWidth
          ? `${membersWidth}px`
          : undefined,
      },
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
      h(SidebarResizer, {
        side: "members",
        onResize: setMembersWidth,
        onReset: () => setMembersWidth(null),
      }),
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
  async function checkDeviceMenu(selector, microphone) {
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    document.querySelector(selector).click();
    await wait();
    const dropdown = document.querySelector(".deviceDropdown");
    const box = dropdown.getBoundingClientRect(),
      sidebar = document
        .querySelector(".channelSidebar")
        .getBoundingClientRect();
    check(
      box.left >= sidebar.left && box.right <= sidebar.right + 1,
      "Device menu escaped channel sidebar width",
    );
    check(
      box.top >= 0 && box.bottom < innerHeight,
      "Device menu escaped viewport",
    );
    const cover = document.createElement("div");
    cover.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;z-index:110;background:#1b2232`;
    document.body.append(cover);
    check(
      dropdown.contains(
        document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        ),
      ),
      "Device menu was covered by chat content",
    );
    cover.remove();
    for (let x = box.left + 10; x < box.right - 10; x += 24)
      for (let y = box.top + 10; y < box.bottom - 10; y += 24) {
        check(
          dropdown.contains(document.elementFromPoint(x, y)),
          "Every part of the device panel stays above microphone, camera and footer controls",
        );
      }
    const option = dropdown.querySelector(
      'select[aria-label="Microphone processing mode"]',
    );
    check(
      !!option === microphone,
      "Processing selector belongs only in microphone menu",
    );
    if (option) {
      const previous = option.value;
      for (const mode of ["raw", "browser", "rnnoise", previous]) {
        option.value = mode;
        option.dispatchEvent(new Event("change", { bubbles: true }));
        await wait();
        check(
          option.value === mode &&
            localStorage.getItem("lc.microphoneMode") === mode,
          "Processing mode did not persist",
        );
      }
    }
    check(
      !/Restart microphone|Disable microphone processing/.test(
        dropdown.textContent,
      ),
      "Retired microphone actions remain in the menu",
    );
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    await wait();
  }
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
  await checkDeviceMenu(
    '.profileMicrophone [aria-label="Choose microphone"]',
    true,
  );
  await checkDeviceMenu('.profileDeafen [aria-label="Output options"]', false);
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
  await checkDeviceMenu('.voiceDock [aria-label="Choose microphone"]', true);
  await checkDeviceMenu('.profileDeafen [aria-label="Output options"]', false);
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
  handle.focus();
  await wait();
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
    `Keyboard resize did not change width (before ${draggedWidth}, after ${sidebar.getBoundingClientRect().width}, preferred ${sidebar.parentElement.style.getPropertyValue("--preferred-sidebar-width")})`,
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
  const outputMenu = document.querySelector(".deviceDropdownPortal");
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
  await window.verifyMessageComposer();
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
  await verifyScreenShareOptions();
  verifyWorkspaceHeaderLayout();
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
      h("button", { "data-chat-jump-target": true, type: "button" }, "Call"),
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
    .querySelector("[data-chat-jump-target]")
    .getBoundingClientRect();
  const arrow = jump.getBoundingClientRect();
  check(
    arrow.bottom <= send.top &&
      Math.abs(arrow.left + arrow.width / 2 - send.left - send.width / 2) < 2,
    "DM jump arrow is not above the Call button",
  );
  jump.click();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches)
    check(
      atBottom(),
      "Reduced-motion jumping must reach the latest message immediately",
    );
  for (
    let frame = 0;
    frame < 80 && (!atBottom() || container.querySelector(".jumpToPresent"));
    frame++
  )
    await wait();
  check(
    atBottom() && !container.querySelector(".jumpToPresent"),
    `Jump arrow did not return to the latest message and disappear (remaining scroll: ${log().scrollHeight - log().clientHeight - log().scrollTop}, arrow visible: ${Boolean(container.querySelector(".jumpToPresent"))})`,
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
  const outgoingHeader = outgoing.querySelector(".messageHeader");
  const ownTime = outgoingHeader.querySelector("time").getBoundingClientRect();
  const ownName = outgoingHeader
    .querySelector(".messageAuthorName")
    .getBoundingClientRect();
  const ownAvatar = outgoingHeader
    .querySelector(".userAvatar")
    .getBoundingClientRect();
  check(
    ownTime.right <= ownName.left && ownName.right <= ownAvatar.left,
    "Sent headers must read time, display name, avatar",
  );
  const incomingHeader = incomingRows[0].querySelector(".messageHeader");
  check(
    incomingHeader.querySelector(".userAvatar").getBoundingClientRect().right <=
      incomingHeader.querySelector(".messageAuthorName").getBoundingClientRect()
        .left &&
      incomingHeader.querySelector(".messageAuthorName").getBoundingClientRect()
        .right <=
        incomingHeader.querySelector("time").getBoundingClientRect().left,
    "Received headers must read avatar, display name, time",
  );
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
  const continuation = container.querySelectorAll("article.messageOwn")[1];
  const continuationTime = continuation.querySelector("time");
  check(
    getComputedStyle(continuationTime).opacity ===
      (matchMedia("(hover: none)").matches ? "1" : "0"),
    "Continuation times stay hidden until interaction on hover-capable devices",
  );
  continuation.querySelector(".profileLink").focus({ preventScroll: true });
  check(
    getComputedStyle(continuationTime).opacity === "1",
    "Keyboard focus reveals the continuation timestamp",
  );
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
