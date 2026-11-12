import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { SessionCache } from "../app/conversation-cache.ts";
import { PictureCache, isLocalPicture } from "../app/picture-cache.ts";

function pictures(maxBytes = 1024, maxEntries = 4, customFetch) {
  const downloads = [],
    revoked = [];
  let serial = 0;
  const cache = new PictureCache(
    maxBytes,
    maxEntries,
    customFetch ??
      (async (url, options) => {
        downloads.push({ url, options });
        return {
          ok: true,
          blob: async () => ({ size: 100, type: "image/png" }),
        };
      }),
    () => `blob:${++serial}`,
    (url) => revoked.push(url),
  );
  return { cache, downloads, revoked };
}
const avatar = "/api/users/user/avatar?v=1",
  server = "/api/servers/server/picture?v=1";

test("picture consumers share both in-flight and completed downloads", async () => {
  const { cache, downloads } = pictures();
  const first = cache.acquire(avatar),
    second = cache.acquire(avatar);
  assert.equal(first.promise, second.promise);
  assert.equal(await first.promise, await second.promise);
  first.release();
  second.release();
  const third = cache.acquire(avatar);
  assert.equal(await third.promise, "blob:1");
  assert.equal(cache.peek(avatar), "blob:1");
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].options.cache, "no-store");
  const updated = cache.acquire(avatar.replace("v=1", "v=2"));
  assert.equal(await updated.promise, "blob:2");
  assert.equal(downloads.length, 2);
  third.release();
  updated.release();
  cache.clear();
});

test("picture eviction revokes idle blobs while active images remain pinned", async () => {
  const { cache, revoked } = pictures(150, 1);
  const first = cache.acquire(avatar);
  await first.promise;
  const second = cache.acquire(server);
  await second.promise;
  assert.deepEqual(revoked, []);
  first.release();
  assert.deepEqual(revoked, ["blob:1"]);
  assert.equal(cache.peek(avatar), undefined);
  assert.equal(cache.peek(server), "blob:2");
  second.release();
  cache.clear();
  assert.deepEqual(revoked, ["blob:1", "blob:2"]);
});

test("separate account caches do not share data and cleared pending downloads cannot publish", async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const { cache } = pictures(1024, 4, () => pending);
  const first = cache.acquire(avatar);
  cache.clear();
  resolve({ ok: true, blob: async () => ({ size: 100, type: "image/png" }) });
  await assert.rejects(first.promise, /expired/);
  const other = pictures();
  assert.equal(other.cache.peek(avatar), undefined);
  const loaded = other.cache.acquire(avatar);
  await loaded.promise;
  assert.equal(other.downloads.length, 1);
  loaded.release();
  other.cache.clear();
});

test("picture cache rejects external URLs and failed downloads can be retried", async () => {
  assert.equal(isLocalPicture("https://example.com/avatar.png"), false);
  assert.equal(
    isLocalPicture("/api/users/user/avatar?v=1&unexpected=true"),
    false,
  );
  assert.equal(isLocalPicture(server), true);
  let count = 0;
  const { cache } = pictures(1024, 4, async () => {
    count++;
    return {
      ok: count > 1,
      blob: async () => ({ size: 100, type: "image/png" }),
    };
  });
  assert.throws(() => cache.acquire("https://example.com/picture.png"));
  const failed = cache.acquire(avatar);
  await assert.rejects(failed.promise);
  failed.release();
  const retried = cache.acquire(avatar);
  await retried.promise;
  assert.equal(count, 2);
  retried.release();
  cache.clear();
});

async function harness(file, extra = {}) {
  const slots = [];
  let cursor = 0;
  const pending = [];
  const hooks = {
    useId() {
      return "hint-test";
    },
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
      return (slots[cursor++] ??= { current: initial });
    },
    useEffect(effect, deps) {
      const index = cursor++,
        previous = slots[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i]))
        pending.push(() => {
          previous?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(file, import.meta.url), "utf8"), {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    }),
    {
      exports,
      AbortController,
      ...extra,
      require(name) {
        if (name === "react") return hooks;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
        return {
          SettingsSection: "section",
          SettingsModal: "dialog",
          MessageDeleteAction: "delete",
          SettingsDestinations: "destinations",
        };
      },
    },
  );
  return {
    render(name, ...args) {
      cursor = 0;
      return exports[name](...args);
    },
    effects() {
      pending.splice(0).forEach((run) => run());
    },
    close() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("information hints support touch toggling, outside dismissal and Escape without changing inputs", async () => {
  let showing = false,
    prevented = 0;
  const listeners = new Map();
  const events = {
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: (name) => listeners.delete(name),
  };
  const view = await harness("../app/information-hint.tsx", {
    window: events,
    document: events,
    innerWidth: 400,
    innerHeight: 600,
  });
  const trigger = view.render("InformationHint", {
    text: "Helpful information",
  });
  trigger.props.ref.current = {
    getBoundingClientRect: () => ({ left: 380, top: 500, bottom: 520 }),
    contains: () => false,
  };
  const tooltip = trigger.props.children[1];
  tooltip.props.ref.current = {
    style: {},
    showPopover: () => {
      showing = true;
    },
    hidePopover: () => {
      showing = false;
    },
    getBoundingClientRect: () => ({ width: 240, height: 100 }),
  };
  view.effects();
  const click = {
    preventDefault: () => {
      prevented++;
    },
    stopPropagation() {},
  };
  trigger.props.onPointerDown();
  trigger.props.onFocus();
  assert.equal(showing, false);
  trigger.props.onClick(click);
  assert.equal(showing, true);
  trigger.props.onPointerLeave();
  assert.equal(showing, true);
  assert.equal(tooltip.props.ref.current.style.left, "152px");
  trigger.props.onClick(click);
  assert.equal(showing, false);
  trigger.props.onClick(click);
  listeners.get("pointerdown")({ target: {} });
  assert.equal(showing, false);
  trigger.props.onKeyDown({
    key: "Enter",
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(showing, true);
  trigger.props.onKeyDown({ key: "Escape", stopPropagation() {} });
  assert.equal(showing, false);
  assert.equal(prevented, 3);
  view.close();
});

test("My messages restores destinations before refreshing and retains them on a network error", async () => {
  const cache = new SessionCache();
  cache.scope("account");
  const rows = [
    {
      id: "m",
      kind: "server",
      groupId: "s",
      groupName: "Saved server",
      text: "hello",
    },
  ];
  cache.set("account", "personal-messages", rows);
  const view = await harness("../app/personal-messages.tsx", {
    fetch: async () => {
      throw new Error("Offline");
    },
  });
  const props = { accountId: "account", currentServerId: "s", cache };
  assert.match(
    JSON.stringify(view.render("PersonalMessages", props)),
    /Saved server/,
  );
  view.effects();
  await flush();
  const result = JSON.stringify(view.render("PersonalMessages", props));
  assert.match(result, /Saved server/);
  assert.match(result, /Offline/);
  assert.deepEqual(cache.get("account", "personal-messages"), rows);
  view.close();
});

test("My messages discards retained history after authorization denial", async () => {
  const cache = new SessionCache();
  cache.scope("account");
  cache.set("account", "personal-messages", [
    { id: "m", kind: "server", groupId: "s", groupName: "Saved server" },
  ]);
  const view = await harness("../app/personal-messages.tsx", {
    fetch: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    }),
  });
  const props = { accountId: "account", currentServerId: "s", cache };
  view.render("PersonalMessages", props);
  view.effects();
  await flush();
  assert.equal(cache.get("account", "personal-messages"), undefined);
  assert.doesNotMatch(
    JSON.stringify(view.render("PersonalMessages", props)),
    /Saved server/,
  );
  view.close();
});
