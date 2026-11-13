import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(name) {
  const exports = {},
    jsx = (type, props) => ({ type, props });
  vm.runInNewContext(
    ts.transpile(
      await readFile(new URL(`../app/${name}.tsx`, import.meta.url), "utf8"),
      {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    ),
    { exports, require: () => ({ jsx, jsxs: jsx }) },
  );
  return exports;
}

test("switches use a whole-row native label, expose checked/disabled semantics and forward the new boolean", async () => {
  const { SwitchControl } = await load("switch-control");
  const changes = [];
  const row = SwitchControl({
    label: "Mirror camera",
    checked: false,
    onChange: (value) => changes.push(value),
  });
  assert.equal(row.type, "label");
  const input = row.props.children.find((child) => child.type === "input");
  assert.equal(input.props.type, "checkbox");
  assert.equal(input.props.role, "switch");
  assert.equal(input.props.checked, false);
  input.props.onChange({ target: { checked: true } });
  assert.deepEqual(changes, [true]);
  assert.equal(
    input.props.checked,
    false,
    "The control remains controlled until the owner commits the change",
  );
  const disabled = SwitchControl({
    label: "Echo cancellation",
    checked: false,
    disabled: true,
    onChange() {},
  });
  assert.equal(
    disabled.props.children.find((child) => child.type === "input").props
      .disabled,
    true,
  );
});

test("segmented controls expose every choice, identify selection and forward the chosen value", async () => {
  const { SegmentedControl } = await load("segmented-control");
  let selected;
  const row = SegmentedControl({
    label: "Channel types",
    value: "text",
    options: [
      { value: "text", label: "Text" },
      { value: "voice", label: "Voice" },
    ],
    onChange: (value) => {
      selected = value;
    },
  });
  assert.equal(row.props.role, "group");
  assert.equal(row.props["aria-label"], "Channel types");
  assert.deepEqual(
    Array.from(row.props.children, (button) => button.props.children),
    ["Text", "Voice"],
  );
  assert.equal(row.props.children[0].props["aria-pressed"], true);
  assert.equal(row.props.children[1].props["aria-pressed"], false);
  row.props.children[1].props.onClick();
  assert.equal(selected, "voice");
});
