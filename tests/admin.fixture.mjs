import React from "react";
import { createRoot } from "react-dom/client";
import { AdminDashboard } from "./admin-dashboard.js";
const owner = "11111111-1111-4111-8111-111111111111",
  userId = "22222222-2222-4222-8222-222222222222",
  serverId = "33333333-3333-4333-8333-333333333333",
  channelId = "44444444-4444-4444-8444-444444444444",
  messageId = "55555555-5555-4555-8555-555555555555",
  peerId = "66666666-6666-4666-8666-666666666666";
let root;
window.setupWorkspaceControlsTest = () => ({ ready: true });
window.verifyAdminDashboard = async () => {
  root?.unmount();
  document.body.replaceChildren();
  history.replaceState({}, "", "/admin");
  window.adminSession = {
    status: "authenticated",
    data: { user: { id: owner, role: "owner" } },
  };
  const user = {
    id: userId,
    name: "Alice",
    handle: "alice.0001",
    status: "online",
    role: "member",
    createdAt: "2026-11-01T12:00:00Z",
  };
  const server = {
      id: serverId,
      name: "Portfolio",
      isMember: true,
      ownerId: owner,
      image: "/api/servers/fixture/picture",
    },
    channel = { id: channelId, name: "general", type: "text" };
  let text = "Original message",
    edited = false;
  const mutations = [],
    requests = [];
  window.fetch = async (url, options = {}) => {
    const query = new URL(url, location.origin).searchParams;
    requests.push(query);
    if (options.method && options.method !== "GET") {
      if (String(url).includes("/api/admin/server-picture")) {
        check(
          options.headers["X-Admin-Confirmed"] === "true",
          "Picture change lacks confirmation",
        );
        mutations.push({ target: "picture", method: options.method });
        server.image = null;
        return Response.json({ image: null });
      }
      const body = JSON.parse(options.body);
      mutations.push(body);
      if (body.text) {
        text = body.text;
        edited = true;
      }
      if (body.target === "server" && body.name) server.name = body.name;
      if (body.target === "server" && body.action === "soundboard")
        server.soundboardCooldownEnabled = body.soundboardCooldownEnabled;
      return Response.json({
        id: body.id ?? serverId,
        name: body.name ?? server.name,
      });
    }
    if (String(url).startsWith("/api/demo-accounts"))
      return Response.json([
        {
          id: peerId,
          name: "Demo visitor",
          status: "active",
          expiresAt: "2026-12-01T12:00:00Z",
          servers: [server],
        },
      ]);
    let rows = [],
      nextPage = null;
    switch (query.get("resource")) {
      case "users":
        rows =
          query.get("page") === "1"
            ? [{ ...user, id: peerId, name: "Bob" }]
            : [user];
        nextPage = query.get("page") === "1" ? null : 1;
        break;
      case "profile":
        rows = [user];
        break;
      case "servers":
        rows = [server];
        break;
      case "server":
        rows = [
          {
            ...server,
            image: server.image ?? null,
            afkChannelId: null,
            memberCount: 2,
            channelCount: 2,
            finalDemoCount: 1,
          },
        ];
        break;
      case "channels":
        rows = [channel, { id: peerId, name: "Lounge", type: "voice_group" }];
        break;
      case "members":
        rows = [user];
        break;
      case "conversations":
        rows = [{ id: peerId, name: "Bob" }];
        break;
      case "messages":
        rows = [
          {
            id: messageId,
            author: "Alice",
            authorId: userId,
            text,
            scope: query.get("scope"),
            peerId,
            peerName: "Bob",
            serverId,
            serverName: "Portfolio",
            channelId,
            channelName: "general",
            kind: "message",
            createdAt: "2026-11-10T14:00:00Z",
            editedAt: edited ? "2026-11-11T14:00:00Z" : null,
            editedByAdmin: edited,
            attachments: [
              { id: peerId, name: "Picture.png", type: "image/png", size: 500 },
            ],
          },
          {
            id: peerId,
            author: "Alice",
            authorId: userId,
            scope: query.get("scope"),
            text: "Deleted message",
            deletedAt: "2026-11-10T14:00:00Z",
          },
        ];
        break;
      case "audit":
        rows = [
          {
            id: messageId,
            action: "message.edit",
            actorId: owner,
            targetId: messageId,
            targetType: "channel-message",
            createdAt: "2026-11-11T14:00:00Z",
          },
        ];
        break;
    }
    return Response.json({ rows, nextPage });
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  root.render(React.createElement(AdminDashboard));
  const check = (condition, label) => {
    if (!condition) throw new Error(label);
  };
  const until = async (predicate, label) => {
    const deadline = performance.now() + 3000;
    while (!predicate() && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 15));
    check(predicate(), label);
  };
  const click = async (text, scope = host) => {
    const button = [...scope.querySelectorAll("button")].find(
      (button) => button.textContent.trim() === text,
    );
    check(button, `Missing button ${text}`);
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  };
  const navigate = async (view, values = {}) => {
    history.pushState(
      {},
      "",
      `/admin?${new URLSearchParams({ view, ...values })}`,
    );
    window.dispatchEvent(new Event("popstate"));
    await new Promise((resolve) => setTimeout(resolve, 40));
  };
  const type = (input, value) => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  await until(() => host.textContent.includes("Alice"), "Users did not load");
  const form = host.querySelector(".adminSearch");
  form.requestSubmit();
  await until(
    () => host.textContent.includes("Alice"),
    "Unchanged search got stuck loading",
  );
  await click("Next");
  await until(() => host.textContent.includes("Bob"), "Next page did not load");
  await click("Previous");
  await until(
    () => host.textContent.includes("Alice"),
    "Previous page did not load",
  );
  host.querySelector(".adminIdentity").click();
  await until(
    () =>
      host.querySelector(".adminProfile") &&
      host.textContent.includes("Portfolio"),
    "User details missing",
  );
  await click("Delete user");
  check(
    document.querySelector("dialog").textContent.includes("Incoming messages"),
    "User retention policy missing",
  );
  await click("Cancel", document.querySelector("dialog"));
  check(mutations.length === 0, "Cancelled user deletion mutated data");
  check(
    !host.textContent.includes("Direct messages") &&
      !host.textContent.includes("Search all server messages"),
    "Message browsing controls remain",
  );
  for (const view of ["direct", "user-messages", "user-server"]) {
    await navigate(view, { userId, userName: "Alice", serverId });
    check(!host.querySelector(".adminMessage"), "Legacy view exposed messages");
  }
  check(
    !requests.some((query) =>
      ["messages", "conversations"].includes(query.get("resource")),
    ),
    "Admin requested message data",
  );
  await click("Servers");
  await until(
    () => host.textContent.includes("Portfolio"),
    "Server list missing",
  );
  await click("Portfolio");
  await until(
    () => host.textContent.includes("Lounge"),
    "Server channels missing",
  );
  const voice = [...host.querySelectorAll(".adminChannel")].find((element) =>
    element.textContent.includes("Lounge"),
  );
  await click("Delete", voice);
  check(
    document.querySelector("dialog").textContent.includes("disconnected"),
    "Active-channel warning missing",
  );
  await click("Cancel", document.querySelector("dialog"));
  await click("Create channel");
  check(
    document.querySelector("dialog select"),
    "Voice channel creation types missing",
  );
  await click("Cancel", document.querySelector("dialog"));
  await until(
    () => host.querySelector(".adminServerSettings"),
    "Server settings did not load",
  );
  const beforeCooldown = mutations.length;
  await click("Remove soundboard cooldown");
  check(
    mutations.length === beforeCooldown,
    "Cooldown changed before confirmation",
  );
  await click("Cancel", document.querySelector("dialog"));
  check(mutations.length === beforeCooldown, "Cancel changed cooldown");
  await click("Remove soundboard cooldown");
  await click("Confirm", document.querySelector("dialog"));
  await until(
    () => host.textContent.includes("Enable soundboard cooldown"),
    "Cooldown control did not refresh",
  );
  check(
    mutations.at(-1).action === "soundboard" &&
      mutations.at(-1).soundboardCooldownEnabled === false &&
      mutations.at(-1).confirmed === true,
    "Cooldown removal lacks confirmed policy",
  );
  await click("Enable soundboard cooldown");
  await click("Confirm", document.querySelector("dialog"));
  await until(
    () => host.textContent.includes("Remove soundboard cooldown"),
    "Cooldown did not restore",
  );
  check(
    mutations.at(-1).soundboardCooldownEnabled === true,
    "Cooldown restoration missing",
  );
  await click("Rename server");
  const beforeRename = mutations.length;
  type(document.querySelector("dialog input"), "Renamed portfolio");
  check(
    mutations.length === beforeRename,
    "Rename mutated before confirmation",
  );
  await click("Confirm", document.querySelector("dialog"));
  await until(
    () =>
      host.querySelector(".adminContext h2")?.textContent ===
      "Renamed portfolio",
    "Server name did not update",
  );
  await click("AFK settings");
  const afk = [...document.querySelectorAll("dialog label")].find((label) =>
    label.textContent.includes("Create an AFK"),
  );
  afk.querySelector("input").click();
  await click("Confirm", document.querySelector("dialog"));
  check(
    mutations.at(-1).action === "afk" && mutations.at(-1).createAfk === true,
    "AFK change lost selection",
  );
  await click("Transfer ownership");
  await until(
    () => document.querySelector('dialog input[name="newServerOwner"]'),
    "Owner choices did not load",
  );
  document.querySelector('dialog input[name="newServerOwner"]').click();
  await click("Confirm", document.querySelector("dialog"));
  check(
    mutations.at(-1).action === "ownership" &&
      mutations.at(-1).ownerId === userId,
    "Ownership target lost",
  );
  await click("Remove picture");
  const beforePicture = mutations.length;
  check(
    document.querySelector("dialog"),
    "Picture removal confirmation missing",
  );
  check(
    mutations.length === beforePicture,
    "Picture removed before confirmation",
  );
  await click("Confirm", document.querySelector("dialog"));
  check(
    mutations.at(-1).target === "picture",
    "Confirmed picture removal failed",
  );
  await click("Delete server");
  check(
    document
      .querySelector("dialog")
      .textContent.includes("losing their final server"),
    "Final demo revocation warning missing",
  );
  type(document.querySelector("dialog input"), "DELETE");
  await click("Confirm", document.querySelector("dialog"));
  check(
    mutations.at(-1).target === "server" &&
      mutations.at(-1).confirm === "DELETE",
    "Server deletion confirmation lost",
  );
  await until(
    () => host.textContent.includes("All servers"),
    "Server deletion did not return to list",
  );
  await click("Create server");
  type(
    document.querySelector('dialog input:not([type="checkbox"])'),
    "New server",
  );
  document.querySelector('dialog input[type="checkbox"]').click();
  await click("Confirm", document.querySelector("dialog"));
  check(
    mutations.at(-1).target === "server" &&
      mutations.at(-1).name === "New server" &&
      mutations.at(-1).createAfk === true,
    "Server creation fields lost",
  );
  await navigate("user", { userId, userName: "Alice" });
  await until(
    () => host.querySelector(".adminProfile"),
    "User profile did not load",
  );
  await click("Delete user");
  type(document.querySelector('dialog input:not([type="checkbox"])'), "DELETE");
  document.querySelector('dialog input[type="checkbox"]').click();
  await click("Confirm", document.querySelector("dialog"));
  check(
    mutations.at(-1).target === "user" &&
      mutations.at(-1).deleteMessages === true,
    "User erasure choice lost",
  );
  await click("Demo accounts");
  await until(
    () => host.textContent.includes("Demo visitor"),
    "Demo management not moved",
  );
  await click("Revoke");
  check(document.querySelector("dialog"), "Demo mutation confirmation missing");
  await click("Cancel", document.querySelector("dialog"));
  await click("Admin log");
  await until(
    () => host.textContent.includes("message.edit"),
    "Audit log missing",
  );
  const shell = host.querySelector(".adminShell");
  check(
    shell.scrollWidth <= shell.clientWidth + 1,
    "Admin layout overflows horizontally",
  );
  window.adminSession = {
    status: "authenticated",
    data: { user: { id: owner, role: "member" } },
  };
  window.dispatchEvent(new Event("admin-session"));
  await until(
    () => host.textContent.includes("Access denied"),
    "Revoked owner retained private dashboard",
  );
  return {
    users: true,
    servers: true,
    serverSettings: true,
    userDeletion: true,
    privateMessagesUnavailable: true,
    confirmations: true,
    demos: true,
    audit: true,
    revokedAccess: true,
  };
};
