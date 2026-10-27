import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

test("settings previews release captures on stop, device change, close, and late permission grants", async () => {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const requests = [];
  const gates = [];
  const audio = { srcObject: null };
  const video = { srcObject: null };
  const hooks = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        slots[index].value,
        (next) => {
          slots[index].value =
            typeof next === "function" ? next(slots[index].value) : next;
        },
      ];
    },
    useRef(initial) {
      const index = cursor++;
      return (slots[index] ??= { current: initial });
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        deps.some((value, i) => !Object.is(value, previous.deps[i]))
      )
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: hooks,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "./voice-activity": {
      microphoneProcessing: () => ({}),
      prepareVoiceActivity: () => ({}),
    },
    "./microphone-gate": {
      readVoiceThreshold: () => -50,
      createMicrophoneGate() {
        const gate = {
          track: {},
          stopped: false,
          stop() {
            this.stopped = true;
          },
        };
        gates.push(gate);
        return gate;
      },
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(
      await readFile(
        new URL("../app/media-tests.tsx", import.meta.url),
        "utf8",
      ),
      {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    ),
    {
      exports,
      require: (name) => {
        assert.ok(name in dependencies);
        return dependencies[name];
      },
      navigator: {
        mediaDevices: {
          getUserMedia: (constraints) =>
            new Promise((resolve) => requests.push({ constraints, resolve })),
        },
      },
      MediaStream: class {
        constructor(tracks) {
          this.tracks = tracks;
        }
      },
    },
  );
  const elements = (node) =>
    Array.isArray(node)
      ? node.flatMap(elements)
      : node && typeof node === "object"
        ? [node, ...elements(node.props?.children)]
        : [];
  let tree;
  const render = (microphoneId = "mic-1") => {
    cursor = 0;
    effects = [];
    tree = exports.MediaTests({ microphoneId, cameraId: "camera-1" });
    for (const element of elements(tree))
      if (element.props.ref)
        element.props.ref.current = element.type === "audio" ? audio : video;
    effects.forEach((effect) => effect());
  };
  const click = (label) => {
    const button = elements(tree).find(
      (element) =>
        element.type === "button" && element.props.children === label,
    );
    assert.ok(button, label);
    button.props.onClick();
  };
  const resolveCapture = async (index) => {
    const track = {
      stopped: false,
      stop() {
        this.stopped = true;
      },
    };
    requests[index].resolve({
      getTracks: () => [track],
      getAudioTracks: () => [track],
    });
    await Promise.resolve();
    await Promise.resolve();
    return track;
  };
  render();
  click("Test microphone");
  render();
  click("Stop microphone test");
  render();
  const lateMic = await resolveCapture(0);
  assert.equal(lateMic.stopped, true);
  assert.equal(
    gates.length,
    0,
    "a stopped test must never attach a late capture",
  );
  click("Test microphone");
  render();
  const firstMic = await resolveCapture(1);
  assert.ok(audio.srcObject);
  render("mic-2");
  assert.equal(firstMic.stopped, true);
  assert.equal(gates[0].stopped, true);
  assert.equal(audio.srcObject, null);
  const secondMic = await resolveCapture(2);
  click("Test camera");
  render("mic-2");
  const firstCamera = await resolveCapture(3);
  assert.ok(video.srcObject);
  click("Stop camera test");
  render("mic-2");
  assert.equal(firstCamera.stopped, true);
  assert.equal(video.srcObject, null);
  click("Test camera");
  render("mic-2");
  slots.forEach((slot) => slot.cleanup?.());
  assert.equal(secondMic.stopped, true);
  assert.equal(gates[1].stopped, true);
  assert.equal(audio.srcObject, null);
  const lateCamera = await resolveCapture(4);
  assert.equal(
    lateCamera.stopped,
    true,
    "closing the dialog must stop a late camera grant",
  );
});
