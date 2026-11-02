import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { applyCallOutput } from "../app/audio-output.ts";

test("remote audio stays attached through callback-only rerenders", async () => {
  // Exercise the actual component with a minimal hook lifecycle host. No
  // browser/audio hardware is required to detect repeated attach/detach calls.
  const source = await readFile(
    new URL("../app/group-call.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "group-call.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const component = ast.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === "RemoteTrackView",
  );
  assert.ok(component);
  const code = ts.transpile(component.getText(ast), {
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.React,
  });
  const slots = [];
  let cursor = 0;
  let effects = [];
  const element = {};
  const useRef = (value) => {
    const index = cursor++;
    slots[index] ??= { current: value };
    return slots[index];
  };
  const useState = (initial) => {
    cursor++;
    return [initial, () => {}];
  };
  const useEffect = (effect, deps) => {
    const index = cursor++;
    const previous = slots[index];
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      effects.push(() => {
        previous?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    }
  };
  const events = [];
  const volumes = [];
  let statsMonitors = 0;
  const track = (name) => ({
    kind: "audio",
    setVolume: (volume) => volumes.push(volume),
    attach: (target) => {
      assert.equal(target, element);
      events.push(`attach ${name}`);
    },
    detach: (target) => {
      assert.equal(target, element);
      events.push(`detach ${name}`);
    },
  });
  const Component = vm.runInNewContext(`${code}; RemoteTrackView`, {
    useRef,
    useState,
    useEffect,
    React: { createElement: (type, props) => ({ type, props }) },
    Track: { Kind: { Audio: "audio", Video: "video" } },
    monitorTrackVideo: () => {
      statsMonitors++;
      return () => {};
    },
  });
  const render = (mediaTrack, hidden = false, volume = 1) => {
    cursor = 0;
    effects = [];
    const output = Component({
      media: { track: mediaTrack },
      onPingChange: () => {},
      hidden,
      volume,
      onFocus: () => {},
    });
    output.props.ref.current = element;
    effects.forEach((effect) => effect());
  };
  const first = track("first");
  render(first);
  for (let i = 0; i < 20; i++) render(first, i % 2 === 0);
  render(first, false, 0.35);
  assert.equal(volumes.at(-1), 0.35);
  render(first, false, 0);
  assert.equal(volumes.at(-1), 0, "deafen silences an existing LiveKit track");
  assert.deepEqual(
    events,
    ["attach first"],
    "speaking and diagnostic renders must not interrupt playback",
  );
  assert.equal(statsMonitors, 0, "audio must not start a video stats poller");
  render(track("replacement"));
  assert.deepEqual(events, [
    "attach first",
    "detach first",
    "attach replacement",
  ]);
  slots.forEach((slot) => slot?.cleanup?.());
  assert.equal(events.at(-1), "detach replacement");
});

test("direct output applies volume, deafen and output device without replacing playback", async () => {
  const stream = {};
  const sinks = [];
  const audio = {
    srcObject: stream,
    async setSinkId(id) {
      sinks.push(id);
    },
  };
  await applyCallOutput(audio, 35, true, "headphones");
  assert.equal(audio.muted, true);
  assert.equal(audio.volume, 0.35);
  await applyCallOutput(audio, 35, false, "");
  assert.equal(audio.muted, false);
  assert.equal(audio.srcObject, stream);
  assert.deepEqual(sinks, ["headphones", ""]);
  const unsupported = {};
  await applyCallOutput(unsupported, 150, false, "");
  assert.equal(unsupported.volume, 1);
});
