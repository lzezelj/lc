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
import { MessageDeleteAction } from "./message-delete-action.js";
import { ChatHistory } from "./chat-history.js";
import { MessageComposer } from "./message-composer.js";
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
import { SettingsNavigation } from "./settings-navigation.js";
import { PersonalMessages } from "./personal-messages.js";
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
import { DiagnosticsIndicator } from "./diagnostics.js";
import { DeviceMenu } from "./device-menu.js";
import { DeviceSelection } from "./device-selection.js";
import { AudioDeviceOptions } from "./audio-device-options.js";
import { UserStatusMenu } from "./user-status-menu.js";
import { CallMediaProvider, useCallAudio } from "./call-media.js";
import { SoundboardButton, useSoundboard } from "./soundboard.js";
import { SoundManager } from "./sound-manager.js";
import { ServerNavButton } from "./server-nav-button.js";
import { VoiceParticipantMenu } from "./voice-participant-menu.js";
import { HelpTour, helpSteps } from "./help-tour.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { useWorkspaceActivity } from "./use-workspace-activity.js";
import { IncomingCallNotice } from "./incoming-call-notice.js";
import { friendCallRoom, conversationHasCall } from "./call-context.js";
import { soundWave } from "./soundboard-catalog.js";
import { RemoteAudioTrack } from "livekit-client";
import { applyRemoteAudioVolume } from "./remote-audio-volume.js";

const h = React.createElement;
const wait = () => new Promise((resolve) => setTimeout(resolve, 60));
const check = (value, message) => {
  if (!value) throw new Error(message);
};

window.verifyMessageComposer = async () => {
  const container = document.createElement("section");
  container.className = "chat";
  container.style.cssText =
    "position:fixed;inset:20px;z-index:10000;display:block";
  document.body.append(container);
  const root = createRoot(container);
  let setText;
  let submitted = 0;
  function Fixture() {
    const [value, onChange] = useState("");
    const [files, onFiles] = useState([]);
    useEffect(() => {
      setText = onChange;
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
    container.querySelector('[aria-label="Remove preview.png"]').click();
    await wait();
    check(
      !container.querySelector(".pendingImage"),
      "Removing an image left its preview behind",
    );
    return {
      growShrink: true,
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
  const render = (deleted = false) =>
    flushSync(() =>
      root.render(
        h(
          "article",
          { className: "messageOwn" },
          h(MessageAttachments, { files: [file, pdf], deleted }),
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
      container.querySelectorAll(".attachmentDownload").length === 2,
      "Each file needs a separate download icon",
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
        "/api/attachments/image-test?download=1" &&
        download.getAttribute("download") === file.name,
      "Download does not use authenticated endpoint/original filename",
    );
    check(
      download.getAttribute("aria-label") === `Download ${file.name}` &&
        download.querySelector("svg"),
      "Download icon needs an accessible label",
    );
    check(
      container.textContent.includes("500 KB") &&
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
        .textContent.includes("Demo accounts") &&
        !container
          .querySelector(".testMemberNavigation")
          .textContent.includes("Demo accounts"),
      "Demo settings visibility is not owner-only",
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

async function verifySoundboard() {
  const originalFetch = window.fetch;
  let publications = 0,
    previewTrack,
    publishedTrack;
  const speaking = [];
  const soundList = [
    { id: "celebrate-v1", name: "Celebrate", serverId: "call-server" },
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `clip-${i}`,
      name: `Sound ${i + 2}`,
      serverId: "call-server",
    })),
  ];
  let uploads = 0,
    removals = 0;
  const joinSoundChanges = [];
  let canManageSounds = true;
  window.fetch = async (url, options = {}) => {
    if (String(url) === "/api/servers/call-server/join-sound") {
      check(
        options.method === "PATCH",
        "Join sound changes must be saved on the server",
      );
      const body = JSON.parse(options.body);
      joinSoundChanges.push(body.joinSoundId);
      return Response.json(body);
    }
    check(
      String(url).startsWith("/api/servers/call-server/soundboard"),
      "The board must use the active call's server",
    );
    if (String(url).includes("/soundboard/play?"))
      return Response.json({ allowed: true });
    if (options.method === "POST") {
      check(
        options.body instanceof File && options.body.size > 44,
        "Custom uploads must send the chosen file",
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
  function Board() {
    const board = useSoundboard("call", {
      onSpeakingChange: (value) => speaking.push(value),
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
      publications === 0 && !speaking.includes(true),
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
    const selection = new DataTransfer();
    selection.items.add(
      new File([soundWave("celebrate-v1")], "Uploaded.wav", {
        type: "audio/wav",
      }),
    );
    fileInput.files = selection.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    await wait();
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
      joinSound.value = "";
      joinSound.dispatchEvent(new Event("change", { bubbles: true }));
      await wait();
      check(
        joinSoundChanges.join(",") === "custom-test,",
        "Server settings saves a soundboard clip and resets to Default",
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
        "Members save the shared server join-sound choice",
      );
    } finally {
      managerRoot.unmount();
      managerHost.remove();
    }
  } finally {
    root.unmount();
    container.remove();
    window.fetch = originalFetch;
  }
  check(
    previewTrack.readyState === "ended" &&
      publishedTrack.readyState === "ended",
    "Leaving must stop local and published sound tracks",
  );
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
  await document.exitFullscreen();
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
    root.render(h(PersonalMessages, { currentServerId: "server" }));
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
      container.querySelector("button").textContent ===
        "Voice channel join sound",
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
      return Response.json({ added: body.userIds });
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
        onAdded: (value) => added.push(value),
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
      invitations[0].mode === "friends" && added[0][0].id === "a",
      "Friend invitations must use the friend-only API mode",
    );
    root.render(
      h(ServerInvites, {
        key: "people",
        serverId: "invite-test",
        mode: "people",
        friends: people,
        memberIds: [],
        onAdded: (value) => added.push(value),
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
      onShare: (value) => shared.push(value),
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
  select.value = "720";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  await wait();
  dialog.querySelector('button[type="submit"]').click();
  check(shared[0] === "720", "Screen sharing must use the chosen resolution");
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
  root.render(
    h(CameraResolutionSelection, {
      resolution: "720",
      onChange: (value) => {
        resolution = value;
      },
    }),
  );
  await wait();
  const cameraSelect = container.querySelector("select");
  cameraSelect.value = "1080";
  cameraSelect.dispatchEvent(new Event("change", { bubbles: true }));
  check(
    resolution === "1080",
    "Camera resolution selector must pass the selected quality",
  );
  const constraints = cameraCaptureConstraints("camera-id", resolution);
  check(
    constraints.width.max === 1920 &&
      constraints.height.max === 1080 &&
      constraints.deviceId.exact === "camera-id",
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
