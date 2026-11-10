import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as limits from "../app/attachment-types.ts";
import { attachmentRange } from "../server/attachment-range.ts";

test("delete confirmations identify attachment-only messages and retain captions and all filenames", () => {
  const photo = {
    id: "photo",
    name: "holiday.png",
    type: "image/png",
    size: 1,
  };
  const video = {
    id: "video",
    name: "holiday.mp4",
    type: "video/mp4",
    size: 1,
  };
  assert.equal(
    limits.messageDeletionPreview({ text: "", attachments: [photo] }),
    "holiday.png",
  );
  assert.equal(
    limits.messageDeletionPreview({ text: "  ", attachments: [video] }),
    "holiday.mp4",
  );
  assert.equal(
    limits.messageDeletionPreview({
      text: "Our trip",
      attachments: [photo, video],
    }),
    "Our trip\nholiday.png\nholiday.mp4",
  );
  assert.equal(limits.messageDeletionPreview({ text: "Hello" }), "Hello");
});

async function moduleAt(path, deps) {
  const exports = {};
  vm.runInNewContext(
    ts.transpile(await readFile(new URL(path, import.meta.url), "utf8"), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    }),
    {
      exports,
      require: (name) => {
        assert.ok(name in deps, name);
        return deps[name];
      },
      Response,
      Request,
      Buffer,
      URL,
      Uint8Array,
      process: { env: {} },
    },
  );
  return exports;
}
const op = (...args) => args;
const orm = { eq: op, and: op, sql: op };
const users = { id: "user.id" },
  attachments = { id: "attachment.id", data: "data", uploaderId: "uploader" };
async function uploadModule(db = {}, notify = async () => {}) {
  return moduleAt("../server/message-attachments.ts", {
    "node:crypto": { randomUUID },
    "drizzle-orm": orm,
    "../db": { db },
    "../db/schema": { messageAttachments: attachments, users },
    "../app/attachment-types": limits,
    "./notify-user": { notifyUser: notify },
  });
}
const uploads = await uploadModule();
function multipart(files, text = "") {
  const form = new FormData();
  form.set("text", text);
  files.forEach((file) => form.append("files", file));
  return new Request("http://localhost/messages", {
    method: "POST",
    body: form,
  });
}
const pdf = (name = "document.pdf") =>
  new File(["%PDF-1.7\nexample"], name, { type: "application/pdf" });
const mp4 = Buffer.from(
  "000000186674797069736f6d0000020069736f6d6d703432",
  "hex",
);
const webm = Buffer.from([
  0x1a,
  0x45,
  0xdf,
  0xa3,
  0x87,
  0x42,
  0x82,
  0x84,
  ...Buffer.from("webm"),
]);

test("video uploads detect MP4/WebM containers and enforce detected-type limits", async () => {
  for (const [bytes, type] of [
    [mp4, "video/mp4"],
    [webm, "video/webm"],
  ]) {
    const result = await uploads.readMessageRequest(
      multipart([new File([bytes], "clip", { type: "text/html" })]),
    );
    assert.equal(result.files[0].metadata.type, type);
  }
  for (const bytes of [
    mp4.subarray(0, 20),
    Buffer.from("00000010667479706176696600000000", "hex"),
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80, ...Buffer.from("webm")]),
  ])
    assert.equal(uploads.attachmentMime(bytes), null);
  const large = new File(
    [mp4, Buffer.alloc(limits.attachmentMaxBytes)],
    "larger-than-image.mp4",
    { type: "image/png" },
  );
  assert.equal(
    (await uploads.readMessageRequest(multipart([large]))).files[0].metadata
      .type,
    "video/mp4",
  );
  const spoofed = new File(
    ["%PDF-1.7", Buffer.alloc(limits.attachmentMaxBytes)],
    "spoof.mp4",
    { type: "video/mp4" },
  );
  assert.equal(
    (await uploads.readMessageRequest(multipart([spoofed]))).status,
    400,
  );
  const tooLarge = new File(
    [mp4, Buffer.alloc(limits.attachmentVideoMaxBytes)],
    "large.mp4",
    { type: "video/mp4" },
  );
  assert.equal(
    (await uploads.readMessageRequest(multipart([tooLarge]))).status,
    400,
  );
});

test("video ranges support seeking, suffixes and clamped ends while rejecting invalid/multiple ranges", () => {
  for (const [header, expected] of [
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=3-", { start: 3, end: 7 }],
    ["bytes=-3", { start: 5, end: 7 }],
    ["bytes=4-99", { start: 4, end: 7 }],
    ["bytes=-99", { start: 0, end: 7 }],
  ])
    assert.deepEqual(attachmentRange(header, 8), expected);
  for (const header of [
    "bytes=8-",
    "bytes=3-1",
    "bytes=-0",
    "bytes=-",
    "bytes=0-1,3-4",
    "bytes=999999999999999999999-",
    "bytes=foo",
    "items=0-1",
  ])
    assert.equal(attachmentRange(header, 8), null);
});

test("multipart detects supported bytes independently of claimed MIME and sanitizes names", async () => {
  const result = await uploads.readMessageRequest(
    multipart(
      [new File(["%PDF-1.7"], "../../file.pdf", { type: "image/png" })],
      "hello",
    ),
  );
  assert.equal(result.text, "hello");
  assert.equal(result.files[0].metadata.type, "application/pdf");
  assert.equal(result.files[0].metadata.name, "file.pdf");
  assert.equal(result.files[0].data.toString(), "%PDF-1.7");
  assert.match(result.files[0].metadata.id, /^[a-f0-9-]{36}$/);
  for (const [bytes, type] of [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
    [Buffer.from([255, 216, 255]), "image/jpeg"],
    [Buffer.from("GIF89a"), "image/gif"],
    [Buffer.from("RIFFxxxxWEBP"), "image/webp"],
  ])
    assert.equal(uploads.attachmentMime(bytes), type);
});
test("upload parser rejects unsupported, empty, oversized and excessive files", async () => {
  const accepted = await uploads.readMessageRequest(
    multipart(Array.from({ length: 12 }, () => pdf())),
  );
  assert.equal(
    accepted.files.length,
    12,
    "multi-row galleries accept more than nine small files",
  );
  for (const files of [
    [new File(["<svg/>"], "fake.png", { type: "image/png" })],
    [new File([], "empty.pdf")],
    [new File([Buffer.alloc(limits.attachmentMaxBytes + 1)], "large.pdf")],
    Array.from({ length: limits.attachmentMaxCount + 1 }, () => pdf()),
  ]) {
    const result = await uploads.readMessageRequest(multipart(files));
    assert.equal(result.status, 400);
  }
  const request = new Request("http://localhost", {
    method: "POST",
    headers: {
      "content-type": "multipart/form-data; boundary=x",
      "content-length": "999999999",
    },
    body: "x",
  });
  assert.equal((await uploads.readMessageRequest(request)).status, 413);
  const chunked = new Request("http://localhost", {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(65537));
        controller.close();
      },
    }),
    duplex: "half",
  });
  assert.equal((await uploads.readMessageRequest(chunked)).status, 413);
});
test("JSON text and call messages remain supported; malformed text returns 400", async () => {
  const request = (value) =>
    new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  const text = await uploads.readMessageRequest(request({ text: "hello" }));
  assert.equal(text.text, "hello");
  assert.equal(text.files.length, 0);
  const call = await uploads.readMessageRequest(
    request({ event: "call-ended", durationSeconds: 30 }),
  );
  assert.equal(call.event, "call-ended");
  assert.equal(call.durationSeconds, 30);
  assert.equal(
    (await uploads.readMessageRequest(request({ text: 42 }))).status,
    400,
  );
});
test("attachment quota locks the account before counting and writes message and bytes in one transaction", async () => {
  const events = [];
  let usage = 0;
  let failInsert = false;
  let failBudget = false;
  const tx = {
    async execute(query) {
      if (failBudget)
        throw Object.assign(new Error("LC_ATTACHMENT_STORAGE_FULL"), {
          code: "P0001",
        });
      if (String(query[0]).includes("lc_attachment_budget"))
        events.push("global-budget");
      return { rows: [{ recipients: [], bytes: usage }] };
    },
    select() {
      return {
        from(table) {
          return {
            where() {
              if (table === users)
                return {
                  async for(mode) {
                    events.push(`lock:${mode}`);
                  },
                };
              events.push("usage");
              return Promise.resolve([{ bytes: usage }]);
            },
          };
        },
      };
    },
    insert(table) {
      assert.equal(table, attachments);
      return {
        async values(rows) {
          events.push("bytes");
          if (failInsert) throw new Error("storage failure");
          assert.equal(rows[0].directMessageId, "message");
          assert.equal(rows[0].messageId, null);
        },
      };
    },
  };
  const api = await uploadModule({
    async transaction(action) {
      events.push("begin");
      try {
        const result = await action(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
  });
  const body = await uploads.readMessageRequest(multipart([pdf()]));
  const create = async (connection, metadata) => {
    assert.equal(connection, tx);
    assert.equal(metadata[0].name, "document.pdf");
    events.push("message");
    return { id: "message", createdAt: new Date() };
  };
  await api.saveAttachedMessage("actor", body.files, true, create);
  assert.deepEqual(events, [
    "begin",
    "global-budget",
    "lock:no key update",
    "usage",
    "message",
    "bytes",
    "commit",
  ]);
  events.length = 0;
  usage = api.attachmentQuotaBytes;
  assert.equal(
    (await api.saveAttachedMessage("actor", body.files, true, create)).status,
    413,
  );
  assert.ok(!events.includes("message"));
  events.length = 0;
  usage = 0;
  failInsert = true;
  await assert.rejects(
    api.saveAttachedMessage("actor", body.files, true, create),
    /storage failure/,
  );
  assert.equal(events.at(-1), "rollback");
  events.length = 0;
  failInsert = false;
  failBudget = true;
  const full = await api.saveAttachedMessage("actor", body.files, true, create);
  assert.equal(full.status, 413);
  assert.match((await full.json()).error, /Global attachment storage is full/);
  assert.deepEqual(events, ["begin", "rollback"]);
});

test("expiry and storage warnings notify users only after the upload commits", async () => {
  const events = [];
  const tx = {
    async execute(query) {
      return {
        rows: [
          String(query[0]).includes("lc_attachment_budget")
            ? { recipients: ["viewer"] }
            : { bytes: 1800000000 },
        ],
      };
    },
    select() {
      return {
        from: () => ({
          where: () =>
            Object.assign(Promise.resolve([{ bytes: 0 }]), {
              for: async () => {},
            }),
        }),
      };
    },
    insert: () => ({ values: async () => {} }),
  };
  const api = await uploadModule(
    {
      transaction: async (action) => {
        const result = await action(tx);
        events.push("commit");
        return result;
      },
    },
    async (user, event) => {
      events.push(`${user}:${event.type}`);
    },
  );
  const body = await uploads.readMessageRequest(multipart([pdf()]));
  const create = async () => ({ id: "message", createdAt: new Date() });
  await api.saveAttachedMessage("actor", body.files, false, create);
  assert.deepEqual(events, [
    "commit",
    "viewer:attachments-expired",
    "actor:attachment-storage-warning",
  ]);
  events.length = 0;
  await assert.rejects(
    api.saveAttachedMessage("actor", body.files, false, create, async () => {
      throw new Error("save failed");
    }),
    /save failed/,
  );
  assert.deepEqual(events, [], "Rolled-back expiry must never be broadcast");
});

async function downloadFixture({
  authenticated = true,
  direct = false,
  member = true,
  friend = true,
  participant = true,
  deleted = false,
  expired = false,
  exists = true,
  type = "application/pdf",
} = {}) {
  const fileId = "22222222-2222-4222-8222-222222222222";
  const metadata = {
    id: fileId,
    name: "file.pdf",
    type,
    size: 8,
    expired,
  };
  const messages = { id: "message.id" },
    directMessages = { id: "direct.id" };
  let byteReads = 0;
  const db = {
    select(fields) {
      return {
        from(table) {
          const query = {
            innerJoin() {
              return query;
            },
            async where() {
              if (table === attachments) {
                if (fields?.data) {
                  byteReads++;
                  const bytes = Buffer.from("%PDF-1.7");
                  return [
                    {
                      data:
                        typeof fields.data === "string"
                          ? bytes
                          : bytes.subarray(
                              fields.data[2] - 1,
                              fields.data[2] - 1 + fields.data[3],
                            ),
                    },
                  ];
                }
                return exists
                  ? [
                      {
                        messageId: direct ? null : "message",
                        directMessageId: direct ? "direct" : null,
                      },
                    ]
                  : [];
              }
              const row = {
                attachments: [metadata],
                deletedAt: deleted ? new Date() : null,
              };
              if (table === directMessages)
                return [
                  {
                    ...row,
                    senderId: participant ? "actor" : "stranger",
                    recipientId: "friend",
                  },
                ];
              return member ? [row] : [];
            },
          };
          return query;
        },
      };
    },
  };
  const route = await moduleAt(
    "../app/api/attachments/[attachmentId]/route.ts",
    {
      "drizzle-orm": orm,
      "../../../../auth": {
        auth: async () => (authenticated ? { user: { id: "actor" } } : null),
      },
      "../../../../db": { db },
      "../../../../db/schema": {
        messages,
        directMessages,
        messageAttachments: attachments,
        channels: {},
        serverMembers: {},
      },
      "../../../../server/friends": { areFriends: async () => friend },
      "../../../../server/attachment-range": { attachmentRange },
    },
  );
  return {
    get: (range, download = false) =>
      route.GET(
        new Request(
          `http://localhost/api/attachments/${fileId}${download ? "?download=1" : ""}`,
          { headers: range ? { Range: range } : {} },
        ),
        {
          params: Promise.resolve({ attachmentId: fileId }),
        },
      ),
    byteReads: () => byteReads,
  };
}

test("video responses authorize before bytes, serve private ranges and retain explicit download", async () => {
  const forbidden = await downloadFixture({ type: "video/mp4", member: false });
  assert.equal((await forbidden.get("bytes=0-1")).status, 404);
  assert.equal(forbidden.byteReads(), 0);
  for (const direct of [false, true]) {
    const f = await downloadFixture({ type: "video/mp4", direct });
    const response = await f.get("bytes=2-4");
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("Content-Range"), "bytes 2-4/8");
    assert.equal(response.headers.get("Content-Length"), "3");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(await response.text(), "DF-");
    assert.match(response.headers.get("Content-Disposition"), /^inline;/);
    assert.match(
      (await f.get(undefined, true)).headers.get("Content-Disposition"),
      /^attachment;/,
    );
  }
  const invalid = await downloadFixture({ type: "video/webm" });
  const response = await invalid.get("bytes=20-");
  assert.equal(response.status, 416);
  assert.equal(response.headers.get("Content-Range"), "bytes */8");
  assert.equal(invalid.byteReads(), 0);
});
test("private downloads require current membership or friendship and exact DM participation", async () => {
  for (const options of [
    { authenticated: false },
    { member: false },
    { deleted: true },
    { expired: true },
    { exists: false },
    { direct: true, participant: false },
    { direct: true, friend: false },
    { direct: true, deleted: true },
    { direct: true, expired: true },
  ]) {
    const fixture = await downloadFixture(options);
    const response = await fixture.get();
    assert.ok([403, 404].includes(response.status));
    assert.equal(fixture.byteReads(), 0);
  }
  for (const direct of [false, true]) {
    const fixture = await downloadFixture({ direct });
    const response = await fixture.get();
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "%PDF-1.7");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(response.headers.get("content-disposition"), /^attachment;/);
  }
});

test("channel and DM endpoints save attachment-only messages and reject unauthorized uploads before parsing", async () => {
  for (const direct of [false, true]) {
    for (const allowed of [false, true]) {
      const channelTable = { id: "channel.id" },
        messageTable = { id: "message.id", createdAt: "createdAt" };
      const writes = [],
        notices = [];
      const connection = {
        execute: async () => ({ rows: [{ recipients: [], bytes: 0 }] }),
        select() {
          return {
            from(table) {
              const chain = {
                innerJoin() {
                  return chain;
                },
                where() {
                  return table === users
                    ? { async for() {} }
                    : Promise.resolve(
                        table === attachments
                          ? [{ bytes: 0 }]
                          : allowed
                            ? [{ id: "channel" }]
                            : [],
                      );
                },
              };
              return chain;
            },
          };
        },
        insert(table) {
          return {
            values(value) {
              writes.push({ table, value });
              return {
                returning: async () => [
                  {
                    id: "new-message",
                    createdAt: new Date("2026-11-04T12:00:00Z"),
                  },
                ],
              };
            },
          };
        },
        update() {
          return {
            set() {
              return { where: async () => {} };
            },
          };
        },
        async transaction(action) {
          return action(connection);
        },
      };
      const helpers = await uploadModule(connection);
      const prefix = direct ? "../../../../" : "../../../../../";
      const route = await moduleAt(
        direct
          ? "../app/api/direct-messages/[userId]/route.ts"
          : "../app/api/channels/[channelId]/messages/route.ts",
        {
          "drizzle-orm": { ...orm, desc: op, lt: op, or: op, inArray: op },
          "drizzle-orm/pg-core": { alias: (table) => table },
          "next/server": {
            NextResponse: {
              json: (body, options) => Response.json(body, options),
            },
          },
          [`${prefix}auth`]: {
            auth: async () => ({ user: { id: "actor", name: "Actor" } }),
          },
          [`${prefix}db`]: { db: connection },
          [`${prefix}db/schema`]: {
            channels: channelTable,
            messages: messageTable,
            directMessages: messageTable,
            friendships: {},
            users,
            serverMembers: {},
          },
          [`${prefix}server/friends`]: { areFriends: async () => allowed },
          [`${prefix}server/rate-limit`]: {
            checkRateLimit: () => ({ allowed: true }),
            rateLimits: { message: {} },
            rateLimitMessage: () => "limited",
          },
          [`${prefix}server/notify-user`]: {
            notifyUser: async (id, notice) => notices.push({ id, notice }),
          },
          [`${prefix}server/message-attachments`]: helpers,
        },
      );
      const request = multipart([pdf()]);
      const response = await route.POST(request, {
        params: Promise.resolve(
          direct ? { userId: "friend" } : { channelId: "channel" },
        ),
      });
      if (!allowed) {
        assert.equal(response.status, 403);
        assert.equal(request.bodyUsed, false);
        assert.equal(writes.length, 0);
        continue;
      }
      assert.equal(response.status, 201);
      const canonical = await response.json();
      assert.equal(canonical.text, "");
      assert.equal(canonical.attachments[0].name, "document.pdf");
      assert.equal(writes.length, 2);
      assert.equal(
        writes[0].value.attachments[0].id,
        canonical.attachments[0].id,
      );
      assert.equal(
        writes[1].value[0][direct ? "directMessageId" : "messageId"],
        "new-message",
      );
      assert.ok(!("data" in canonical.attachments[0]));
      if (direct)
        assert.equal(
          notices[0].notice.message.attachments[0].id,
          canonical.attachments[0].id,
        );
    }
  }
});
