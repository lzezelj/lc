import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { mergeHelpBoxes } from "../app/help-geometry.ts";

test("adjacent voice rows and overlapping sidebar/message frames become one outline", () => {
  assert.deepEqual(
    mergeHelpBoxes([
      { x: 10, y: 20, width: 100, height: 40 },
      { x: 10, y: 58, width: 100, height: 40 },
    ]),
    [{ x: 10, y: 20, width: 100, height: 78 }],
  );
  assert.deepEqual(
    mergeHelpBoxes([
      { x: 0, y: 10, width: 35, height: 100 },
      { x: 30, y: 0, width: 150, height: 200 },
    ]),
    [{ x: 0, y: 0, width: 180, height: 200 }],
  );
});

test("merging handles nested and transitively touching frames without changing the input", () => {
  const input = [
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 24, y: 0, width: 10, height: 10 },
    { x: 12, y: 0, width: 10, height: 10 },
    { x: 3, y: 3, width: 2, height: 2 },
  ];
  const before = structuredClone(input);
  assert.deepEqual(mergeHelpBoxes(input), [
    { x: 0, y: 0, width: 34, height: 10 },
  ]);
  assert.deepEqual(input, before);
});

test("separate controls retain separate outlines", () => {
  const input = [
    { x: 10, y: 10, width: 30, height: 20 },
    { x: 100, y: 100, width: 30, height: 20 },
  ];
  assert.deepEqual(mergeHelpBoxes(input), input);
  assert.deepEqual(mergeHelpBoxes([]), []);
});

test("guide switches between Friends and an available server, then restores the original view without leaving a call", async () => {
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
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "handleHelpStep")
      declaration = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const friend = { id: "selected-friend" };
  const context = {
    helpPreviousView: { current: null },
    friendsView: false,
    selectedFriend: friend,
    callViewOpen: true,
    selectedServerId: "server-a",
    selectedChannelId: "text-a",
    servers: [{ id: "server-a" }],
    switchServer(id) {
      context.selectedServerId = id;
    },
    leaveRoom: () => {
      throw new Error("Tour navigation must preserve the call");
    },
  };
  for (const name of [
    "FriendsView",
    "SelectedFriend",
    "CallViewOpen",
    "SelectedChannelId",
    "SelectedServerId",
  ]) {
    const key = name[0].toLowerCase() + name.slice(1);
    context[`set${name}`] = (value) => {
      context[key] = value;
    };
  }
  const step = vm.runInNewContext(
    `${ts.transpile(declaration)}; handleHelpStep`,
    context,
  );
  for (const originallyFriends of [false, true]) {
    context.friendsView = originallyFriends;
    step(0);
    step(1);
    step(1);
    assert.equal(context.friendsView, true);
    assert.equal(context.selectedFriend, null);
    assert.equal(context.callViewOpen, false);
    step(2);
    assert.equal(context.friendsView, false);
    assert.equal(context.selectedServerId, "server-a");
    assert.equal(context.callViewOpen, false);
    step(8);
    assert.equal(
      context.friendsView,
      false,
      "server-only mention guidance must leave DMs",
    );
    step(null);
    assert.equal(context.friendsView, originallyFriends);
    assert.equal(context.selectedFriend, friend);
    assert.equal(context.callViewOpen, true);
    assert.equal(context.helpPreviousView.current, null);
  }
  context.servers = [];
  context.friendsView = true;
  step(0);
  step(2);
  assert.equal(
    context.friendsView,
    true,
    "accounts without servers must stay in a usable view",
  );
  step(null);
  context.servers = [{ id: "fallback-server" }];
  context.selectedServerId = "";
  context.selectedChannelId = "";
  step(0);
  step(2);
  assert.equal(context.friendsView, false);
  assert.equal(
    context.selectedServerId,
    "fallback-server",
    "DM-only navigation selects an available server",
  );
  step(null);
  assert.equal(context.friendsView, true);
  assert.equal(
    context.selectedServerId,
    "",
    "closing restores an originally unset server selection",
  );
});
