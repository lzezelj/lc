import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(
  new URL("../app/use-search-debounce.ts", import.meta.url),
  "utf8",
);

function fixture() {
  let cursor = 0,
    now = 0;
  const slots = [],
    timers = new Map();
  let effects = [];
  const same = (a, b) =>
    a?.length === b.length &&
    b.every((value, index) => Object.is(value, a[index]));
  const react = {
    useRef: (value) => {
      const index = cursor++;
      slots[index] ??= { current: value };
      return slots[index];
    },
    useState: (value) => {
      const index = cursor++;
      slots[index] ??= { value };
      return [
        slots[index].value,
        (next) => {
          slots[index].value = next;
        },
      ];
    },
    useCallback: (action, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { action, deps };
      return slots[index].action;
    },
    useEffect: (action, deps) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps))
        effects.push(() => {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: action() };
        });
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpile(source, {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      require: (name) => {
        assert.equal(name, "react");
        return react;
      },
      setTimeout: (action, delay) => {
        const id = {};
        timers.set(id, { action, at: now + delay });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  return {
    hooks: exports,
    render: (action) => {
      cursor = 0;
      effects = [];
      const result = action(exports);
      effects.forEach((effect) => effect());
      return result;
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of timers)
        if (timer.at <= now) {
          timers.delete(id);
          timer.action();
        }
    },
    unmount: () => slots.forEach((slot) => slot?.cleanup?.()),
  };
}

test("local searches settle 500 ms after the latest edit and clean up on unmount", () => {
  const f = fixture();
  let query = "";
  const render = () =>
    f.render(({ useDebouncedValue }) => useDebouncedValue(query));
  assert.equal(render(), "");
  query = "al";
  assert.equal(render(), "");
  f.advance(499);
  assert.equal(render(), "");
  query = "alice";
  render();
  f.advance(499);
  assert.equal(render(), "");
  f.advance(1);
  assert.equal(render(), "alice");
  query = "bob";
  render();
  f.unmount();
  f.advance(500);
  assert.equal(render(), "alice");
});

test("scheduled API searches coalesce edits, use current callbacks and cancel on dismissal/unmount", () => {
  const f = fixture(),
    calls = [];
  let prefix = "old";
  const render = () =>
    f.render(({ useDebouncedSearch }) => {
      const label = prefix;
      return useDebouncedSearch((query) => calls.push(`${label}:${query}`));
    });
  let search = render();
  search.schedule("al");
  f.advance(250);
  search.schedule("alice");
  prefix = "new";
  search = render();
  f.advance(499);
  assert.deepEqual(calls, []);
  f.advance(1);
  assert.deepEqual(calls, ["new:alice"]);
  search.schedule("cancelled");
  search.cancel();
  f.advance(500);
  assert.equal(calls.length, 1);
  search.schedule("unmounted");
  f.unmount();
  f.advance(500);
  assert.equal(calls.length, 1);
});

test("clicking outside conversation search cancels pending work before results have opened", async () => {
  const component = await readFile(
    new URL("../app/conversation-search.tsx", import.meta.url),
    "utf8",
  );
  const ast = ts.createSourceFile(
    "conversation-search.tsx",
    component,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let effect;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "useEffect" &&
      node.arguments[0].getText(ast).includes('"pointerdown"')
    )
      effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const events = [],
    listeners = new Map();
  const start = vm.runInNewContext(ts.transpile(`(${effect})`), {
    open: false,
    query: "alice",
    cancel: () => events.push("cancel"),
    request: { current: { abort: () => events.push("abort") } },
    host: { current: { contains: () => false } },
    setBusy: (value) => events.push(value),
    setOpen: (value) => events.push(value),
    document: {
      addEventListener: (type, handler) => listeners.set(type, handler),
      removeEventListener: (type) => listeners.delete(type),
    },
  });
  const cleanup = start();
  assert.ok(listeners.has("pointerdown"));
  listeners.get("pointerdown")({ target: {} });
  assert.deepEqual(events, ["cancel", "abort", false, false]);
  cleanup();
  assert.equal(listeners.size, 0);
});
