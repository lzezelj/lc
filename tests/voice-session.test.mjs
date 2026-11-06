import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { timingSafeEqual } from "node:crypto";

const source = await readFile(
  new URL(
    "../app/api/channels/[channelId]/livekit-token/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const sessionId = "00000000-0000-4000-8000-000000000001";

function fixture(options = {}) {
  const events = [],
    exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      AbortSignal,
      process: {
        env: {
          LIVEKIT_URL: "ws://media.invalid",
          LIVEKIT_API_KEY: "test-only",
          LIVEKIT_API_SECRET: "test-only",
          AUTH_SECRET: "test-only",
        },
      },
      fetch: async (url, request) => {
        events.push({ url, body: JSON.parse(request.body) });
        if (options.networkError) throw new Error("offline");
        return { ok: !options.unavailable };
      },
      require: (name) =>
        ({
          "drizzle-orm": { and() {}, eq() {} },
          "livekit-server-sdk": {
            TrackSource: { CAMERA: 1, SCREEN_SHARE: 3 },
            AccessToken: class {
              constructor(_key, _secret, settings) {
                events.push({ settings });
              }
              addGrant(grant) {
                events.push({ grant });
              }
              async toJwt() {
                return "test-token";
              }
            },
          },
          "next/server": { NextResponse: { json: Response.json } },
          "../../../../../auth": {
            auth: async () =>
              options.unauthorized
                ? null
                : { user: { id: "account", name: "Ada" } },
          },
          "../../../../../db": {
            db: {
              select: () => ({
                from: () => ({
                  innerJoin: () => ({
                    where: async () =>
                      options.forbidden
                        ? []
                        : [{ id: "group", serverId: "server" }],
                  }),
                }),
              }),
            },
          },
          "../../../../../db/schema": { channels: {}, serverMembers: {} },
          "../../../../../server/rate-limit": {
            checkRateLimit: () => ({ allowed: true }),
            rateLimits: { livekitToken: {} },
          },
          "../../../../../server/voice-moderation": {
            readVoicePolicies: async () => options.voicePolicies ?? {},
          },
          "../../../../voice-policy": {
            voiceBlocked: (policy) =>
              Boolean(policy?.voiceMuted || policy?.voiceDeafened),
          },
        })[name],
    },
  );
  return {
    events,
    run: (body = { sessionId, userId: "forged" }) =>
      exports.POST(
        new Request("http://local/token", {
          method: "POST",
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ channelId: "group" }) },
      ),
  };
}

test("group tokens claim voice using the authenticated account before signing a short-lived room token", async () => {
  const result = fixture();
  assert.equal((await result.run()).status, 201);
  assert.deepEqual(result.events[0].body, {
    userId: "account",
    roomId: "group",
    sessionId,
  });
  assert.equal(result.events[1].settings.identity, `account:${sessionId}`);
  assert.equal(result.events[1].settings.ttl, "30s");
  assert.equal(result.events[2].grant.room, "channel-group");
});

test("group admission fails closed without issuing tokens when coordination fails", async () => {
  for (const options of [{ unavailable: true }, { networkError: true }]) {
    const result = fixture(options);
    assert.equal((await result.run()).status, 503);
    assert.equal(result.events.length, 1);
  }
});

test("server mute and deafen restrict fresh group tokens to video sources", async () => {
  for (const policy of [{ voiceMuted: true }, { voiceDeafened: true }]) {
    const f = fixture({ voicePolicies: { account: policy } });
    const response = await f.run();
    assert.equal(response.status, 201);
    assert.equal(
      f.events.find((event) => event.grant).grant.canSubscribe,
      !policy.voiceDeafened,
    );
    assert.deepEqual(
      [...f.events.find((event) => event.grant).grant.canPublishSources],
      [1, 3],
    );
    assert.deepEqual((await response.json()).voicePolicies, {
      account: policy,
    });
  }
});

test("unauthorized, inaccessible and invalid group requests never claim or sign voice sessions", async () => {
  for (const [options, body, status] of [
    [{ unauthorized: true }, { sessionId }, 401],
    [{ forbidden: true }, { sessionId }, 403],
    [{}, {}, 400],
    [{}, { sessionId: "invalid" }, 400],
  ]) {
    const result = fixture(options);
    assert.equal((await result.run(body)).status, status);
    assert.deepEqual(result.events, []);
  }
});

const mediaSource = await readFile(
  new URL("../server/voice-sessions.mjs", import.meta.url),
  "utf8",
);
test("SFU cleanup scans rooms and removes only exact account-prefixed identities, failing on service errors", async () => {
  const removed = [],
    exports = {};
  let fail = false;
  vm.runInNewContext(
    ts.transpile(mediaSource, { module: ts.ModuleKind.CommonJS }),
    {
      exports,
      process: {
        env: {
          LIVEKIT_URL: "ws://media.invalid",
          LIVEKIT_API_KEY: "test",
          LIVEKIT_API_SECRET: "test",
        },
      },
      require: () => ({
        RoomServiceClient: class {
          async listRooms() {
            return [{ name: "one" }, { name: "two" }];
          }
          async listParticipants() {
            if (fail) throw new Error("offline");
            return [
              { identity: "account:session" },
              { identity: "account-other:session" },
              { identity: "other:session" },
            ];
          }
          async removeParticipant(room, identity) {
            removed.push([room, identity]);
          }
        },
      }),
    },
  );
  await exports.removeAccountGroupMedia("account");
  assert.deepEqual(removed, [
    ["one", "account:session"],
    ["two", "account:session"],
  ]);
  fail = true;
  await assert.rejects(exports.removeAccountGroupMedia("account"));
  fail = false;
  removed.length = 0;
  await exports.removeAccountGroupMedia("account", "session");
  assert.deepEqual(
    removed,
    [],
    "reclaiming a call preserves that returning device's media identity",
  );
});

const internalSource = await readFile(
  new URL("../app/api/internal/voice-media/route.ts", import.meta.url),
  "utf8",
);
test("internal media cleanup authenticates its secret, validates accounts and reports SFU failures", async () => {
  const exports = {},
    removed = [];
  let fail = false;
  vm.runInNewContext(
    ts.transpile(internalSource, { module: ts.ModuleKind.CommonJS }),
    {
      exports,
      Buffer,
      Response,
      process: { env: { SIGNALING_INTERNAL_SECRET: "test-internal" } },
      require: (name) =>
        ({
          "node:crypto": { timingSafeEqual },
          "next/server": { NextResponse: { json: Response.json } },
          "../../../../server/voice-sessions.mjs": {
            removeAccountGroupMedia: async (id) => {
              if (fail) throw new Error("offline");
              removed.push(id);
            },
          },
        })[name],
    },
  );
  const run = (secret, body = { userId: "account" }) =>
    exports.POST(
      new Request("http://local/internal", {
        method: "POST",
        headers: secret ? { Authorization: `Bearer ${secret}` } : {},
        body: JSON.stringify(body),
      }),
    );
  for (const secret of [null, "incorrect", "wrong-secret!"])
    assert.equal((await run(secret)).status, 401);
  assert.deepEqual(removed, []);
  assert.equal((await run("test-internal", {})).status, 400);
  assert.equal((await run("test-internal")).status, 204);
  assert.deepEqual(removed, ["account"]);
  fail = true;
  assert.equal((await run("test-internal")).status, 503);
});

test("replacement closes only the matching native call and reports the transfer", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const handlers = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ["handleSignal", "handleVoiceReplacement", "handleGroupLeave"].includes(
        node.name?.text,
      )
    )
      handlers.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const events = [],
    voiceSessionId = { current: "active" },
    disconnectedVoiceSessionId = { current: "" };
  const leave = () => {
    events.push("leave");
    voiceSessionId.current = "";
    disconnectedVoiceSessionId.current = "";
  };
  const { handleSignal: handle, handleGroupLeave } = vm.runInNewContext(
    `${ts.transpile(handlers.join("\n"))}; ({ handleSignal, handleGroupLeave })`,
    {
      voiceSessionId,
      disconnectedVoiceSessionId,
      closeCallViewRef: { current: leave },
      returnToPreviousTextChannel: leave,
      setNoticeMessage: (text) => events.push(text),
      setVoiceTransferOpen: (open) => events.push({ dialogOpen: open }),
      setErrorMessage: (text) => events.push(text),
    },
  );
  await handle({ type: "voice-replaced", sessionId: "obsolete" });
  assert.deepEqual(events, []);
  await handle({ type: "voice-replaced", sessionId: "active" });
  assert.equal(events[0], "leave");
  assert.deepEqual(events[1], { dialogOpen: true });
  events.length = 0;
  await handle({ type: "voice-transfer-failed" });
  assert.equal(events[0], "leave");
  assert.match(events[1], /try again/);

  events.length = 0;
  voiceSessionId.current = "group-session";
  handleGroupLeave("group-session");
  assert.deepEqual(events, ["leave"]);
  assert.equal(voiceSessionId.current, "");
  await handle({ type: "voice-replaced", sessionId: "group-session" });
  assert.equal(
    events.length,
    2,
    "a notice still appears after LiveKit cleanup, without leaving twice",
  );
  assert.deepEqual(events[1], { dialogOpen: true });
  await handle({ type: "voice-replaced", sessionId: "group-session" });
  assert.equal(events.length, 2, "duplicate notices are ignored");

  events.length = 0;
  voiceSessionId.current = "new-call";
  disconnectedVoiceSessionId.current = "old-group";
  await handle({ type: "voice-replaced", sessionId: "old-group" });
  handleGroupLeave("old-group");
  assert.deepEqual(
    events,
    [],
    "late events and cleanup cannot affect a newer call",
  );
  assert.equal(voiceSessionId.current, "new-call");
});

test("call replacement notices are accessible and dismissible in Friends, server and no-server workspaces", async () => {
  const page = await readFile(
    new URL("../app/page.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "page.tsx",
    page,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const workspaces = [];
  let notice;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "noticeToast"
    )
      notice = node;
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(ast) === "WorkspaceShell"
    )
      workspaces.push(node);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(workspaces.length, 3);
  for (const workspace of workspaces)
    for (const overlay of ["noticeToast", "voiceTransferDialog", "errorToast"])
      assert.ok(
        workspace.children.some(
          (child) =>
            ts.isJsxExpression(child) &&
            child.expression?.getText(ast) === overlay,
        ),
      );
  const dismissed = [];
  const tree = vm.runInNewContext(
    `${ts.transpile(`const ${notice.getText(ast)};`, { jsx: ts.JsxEmit.React })}; noticeToast`,
    {
      noticeMessage: "You joined a channel on another device or tab.",
      setNoticeMessage: (message) => dismissed.push(message),
      React: {
        createElement: (type, props, ...children) => ({
          type,
          props,
          children,
        }),
      },
    },
  );
  assert.equal(tree.props.role, "status");
  assert.equal(
    tree.children[0].children[0],
    "You joined a channel on another device or tab.",
  );
  tree.children[1].props.onClick();
  assert.deepEqual(dismissed, [""]);
});

test("voice-transfer confirmation keeps focus in its OK dialog and restores focus when closed", async () => {
  const source = await readFile(
    new URL("../app/voice-transfer-dialog.tsx", import.meta.url),
    "utf8",
  );
  const effects = [],
    events = [],
    exports = {};
  class Element {
    isConnected = true;
    focus() {
      events.push("restore focus");
    }
  }
  const button = { focus: () => events.push("focus OK") };
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
    }),
    {
      exports,
      HTMLElement: Element,
      document: { activeElement: new Element() },
      React: {
        createElement: (type, props, ...children) => ({
          type,
          props,
          children,
        }),
      },
      require: () => ({
        useRef: () => ({ current: button }),
        useEffect: (effect) => effects.push(effect),
      }),
    },
  );
  const tree = exports.VoiceTransferDialog({
    onClose: () => events.push("close"),
  });
  const dialog = tree.children[0],
    ok = dialog.children[2].children[0];
  assert.equal(dialog.props.role, "alertdialog");
  assert.equal(dialog.props["aria-modal"], "true");
  assert.equal(ok.children[0], "OK");
  const cleanup = effects[0]();
  dialog.props.onKeyDown({
    key: "Tab",
    preventDefault: () => events.push("trap Tab"),
  });
  ok.props.onClick();
  cleanup();
  assert.deepEqual(events, [
    "focus OK",
    "trap Tab",
    "focus OK",
    "close",
    "restore focus",
  ]);
});
