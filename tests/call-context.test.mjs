import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as context from "../app/call-context.ts";

const call = {
  fromUserId: "alice",
  fromName: "Alice",
  roomId: context.friendCallRoom("me", "alice"),
};
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
const declarations = new Map(),
  effects = [];
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer
  )
    declarations.set(node.name.text, node.initializer.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect")
    effects.push(node.arguments[0].getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);

test("DM call status matches the exact friend pair and never a server voice channel", () => {
  assert.equal(
    context.friendCallRoom("me", "alice"),
    context.friendCallRoom("alice", "me"),
  );
  assert.equal(
    context.conversationHasCall("server-voice-channel", "me", "alice"),
    false,
  );
  assert.equal(context.conversationHasCall(call.roomId, "me", "bob"), false);
  assert.equal(context.conversationHasCall(call.roomId, "me", "alice"), true);
  assert.equal(context.isFriendCall("server-voice-channel"), false);
  assert.equal(context.isFriendCall(call.roomId), true);
  assert.equal(context.isFriendCall("friend::"), false);
});

test("DND hides incoming popups while retaining the matching conversation's invitation", () => {
  assert.equal(context.incomingCallLocation("dnd", call, "bob"), "hidden");
  assert.equal(context.incomingCallLocation("dnd", call), "hidden");
  assert.equal(
    context.incomingCallLocation("dnd", call, "alice"),
    "conversation",
  );
  assert.equal(context.incomingCallLocation("online", call, "bob"), "popup");
  assert.equal(
    context.incomingCallLocation("online", call, "alice"),
    "conversation",
  );
  assert.equal(context.incomingCallLocation("online", null, "alice"), "hidden");
});

test("call cancellation requires both the caller and room, protecting unrelated server calls/invitations", () => {
  assert.equal(
    context.incomingCallMatches(call, {
      fromUserId: "alice",
      roomId: call.roomId,
    }),
    true,
  );
  assert.equal(
    context.incomingCallMatches(call, {
      fromUserId: "bob",
      roomId: call.roomId,
    }),
    false,
  );
  assert.equal(
    context.incomingCallMatches(call, {
      fromUserId: "alice",
      roomId: "server-voice-channel",
    }),
    false,
  );
});

test("a DM decline cannot close a two-person server call or an unrelated friend room", () => {
  let decline;
  function find(node) {
    if (
      ts.isIfStatement(node) &&
      node.expression.getText(ast).includes('message.type === "call-decline"')
    )
      decline = node.getText(ast);
    ts.forEachChild(node, find);
  }
  find(ast);
  for (const roomId of [
    "server-channel",
    context.friendCallRoom("me", "bob"),
    call.roomId,
  ]) {
    let closed = 0,
      recorded = 0;
    vm.runInNewContext(ts.transpile(decline), {
      message: {
        type: "call-decline",
        fromName: "Alice",
        fromUserId: "alice",
        roomId: call.roomId,
      },
      directRoomId: { current: roomId },
      isFriendCall: context.isFriendCall,
      recordCallOutcomeRef: { current: () => recorded++ },
      closeCallViewRef: { current: () => closed++ },
    });
    assert.equal(closed, roomId === call.roomId ? 1 : 0);
    assert.equal(recorded, closed);
  }
});

test("actual call notice renders local Answer/Decline controls only in the correct DND conversation", async () => {
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpile(
      await readFile(
        new URL("../app/incoming-call-notice.tsx", import.meta.url),
        "utf8",
      ),
      { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    ),
    {
      exports,
      require: (name) =>
        name === "./call-context" ? context : { jsx, jsxs: jsx },
    },
  );
  const actions = [];
  const props = {
    call,
    status: "dnd",
    conversationUserId: "alice",
    onAnswer: () => actions.push("answer"),
    onDecline: () => actions.push("decline"),
  };
  assert.equal(exports.IncomingCallNotice(props), null);
  const notice = exports.IncomingCallNotice({ ...props, inline: true });
  assert.equal(notice.props.role, "status");
  notice.props.children[1].props.onClick();
  notice.props.children[2].props.onClick();
  assert.deepEqual(actions, ["decline", "answer"]);
  assert.equal(
    exports.IncomingCallNotice({
      ...props,
      conversationUserId: "bob",
      inline: true,
    }),
    null,
  );
});

test("DND masks badge/title notifications without deleting accumulated unread state", () => {
  const unreadDirectMessages = { alice: 4 };
  const base = {
    incomingFriendRequestCount: 2,
    unreadMessageCount: 4,
    workspaceActivity: {
      channels: [{ id: "text", serverId: "server" }],
      unread: { text: true },
    },
    unreadDirectMessages,
  };
  for (const notificationsEnabled of [false, true]) {
    const values = { ...base, notificationsEnabled };
    assert.equal(
      vm.runInNewContext(declarations.get("notificationCount"), values),
      notificationsEnabled ? 6 : 0,
    );
    assert.equal(
      vm.runInNewContext(declarations.get("unreadServerIds"), values).size,
      notificationsEnabled ? 1 : 0,
    );
    const document = { title: "LC" };
    const effect = effects.find((source) =>
      source.includes("document.title ="),
    );
    vm.runInNewContext(`(${effect})()`, { ...values, document });
    assert.equal(document.title, notificationsEnabled ? "(4) LC" : "LC");
  }
  assert.deepEqual(unreadDirectMessages, { alice: 4 });
});

test("DND suppresses ringing and status changes do not restart the invitation expiry", () => {
  const ringing = effects.find((source) =>
    source.includes('playVoiceSound("ring")'),
  );
  const expiry = effects.find((source) =>
    source.includes("setIncomingCall(null), 20_000"),
  );
  let rings = 0,
    expired = 0;
  const timers = [];
  const fixture = {
    incomingCall: call,
    prepareVoiceSounds() {},
    playVoiceSound: () => rings++,
    setIncomingCall: () => expired++,
    window: {
      setTimeout: (callback, delay) => {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimeout() {},
      setInterval: () => 1,
      clearInterval() {},
    },
  };
  vm.runInNewContext(`(${expiry})()`, fixture);
  const stop = vm.runInNewContext(`(${ringing})()`, {
    ...fixture,
    userStatus: "online",
  });
  stop();
  vm.runInNewContext(`(${ringing})()`, { ...fixture, userStatus: "dnd" });
  assert.equal(rings, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 20000);
  timers[0].callback();
  assert.equal(expired, 1);
});
