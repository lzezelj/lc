import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import ts from "typescript";
import { createHmac } from "node:crypto";
import { parse } from "dotenv";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const useTurn = process.argv.includes("--turn");
const directIp = process.argv.includes("--direct-ip");
const navigation = process.argv.includes("--navigation");
let rtcConfiguration = {};
if (useTurn) {
  const local = parse(await readFile(new URL("../.env", import.meta.url)));
  const config = { ...local, ...process.env };
  if (!config.TURN_SECRET || !config.TURN_URLS)
    throw new Error("TURN configuration is missing");
  const username = `${Math.floor(Date.now() / 1000) + 600}:connectivity-test`;
  const credential = createHmac("sha1", config.TURN_SECRET)
    .update(username)
    .digest("base64");
  const urls = config.TURN_URLS.split(",").map((url) => {
    const trimmed = url.trim();
    return directIp
      ? trimmed.replace(/^(turns?:)[^:]+:/, `$1${config.TURN_EXTERNAL_IP}:`)
      : trimmed;
  });
  rtcConfiguration = {
    iceServers: [{ urls, username, credential }],
    iceTransportPolicy: "relay",
  };
}

// Optional Windows integration check. Uses real browser ICE/DTLS/RTP and a
// generated tone, without requiring microphone access or an external service.
const directory = await mkdtemp(join(tmpdir(), "lc-webrtc-"));
let navigationCode = "";
if (navigation) {
  const require = createRequire(import.meta.url);
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  const component = await readFile(
    new URL("../app/call-media.tsx", import.meta.url),
    "utf8",
  );
  await writeFile(
    join(directory, "call-media.js"),
    ts.transpile(component, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    }),
  );
  await writeFile(
    join(directory, "entry.mjs"),
    await readFile(
      new URL("./call-navigation.fixture.mjs", import.meta.url),
      "utf8",
    ),
  );
  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: "development",
      target: "web",
      devtool: false,
      entry: join(directory, "entry.mjs"),
      output: { path: directory, filename: "navigation.js" },
      resolve: {
        modules: [fileURLToPath(new URL("../node_modules", import.meta.url))],
      },
    });
    compiler.run((error, stats) =>
      compiler.close(() => {
        if (error) reject(error);
        else if (stats.hasErrors())
          reject(new Error(stats.toString({ all: false, errors: true })));
        else resolve();
      }),
    );
  });
  navigationCode = await readFile(join(directory, "navigation.js"), "utf8");
}
const browser = spawn(
  process.env.LC_TEST_BROWSER ??
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  [
    "--headless",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${directory}`,
    "about:blank",
  ],
  { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
);
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Browser debugging endpoint did not start")),
      15000,
    );
    browser.once("error", reject);
    browser.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let id = 0;
  const pending = new Map();
  socket.on("message", (raw) => {
    const message = JSON.parse(raw);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });
  const call = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Browser command timed out: ${method}`));
      }, 20000);
      pending.set(requestId, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    });
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const source = await readFile(
    new URL("../app/direct-negotiation.ts", import.meta.url),
    "utf8",
  );
  const queueCode = ts
    .transpile(source, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    })
    .replace("export function", "function");
  const result = await call(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
      timeout: 20000,
      expression: navigation
        ? `${navigationCode}; window.runCallNavigationTest()`
        : `(async () => {
    ${queueCode}
    const context = new AudioContext();
    await context.resume();
    const tone = context.createOscillator();
    const capture = context.createMediaStreamDestination();
    tone.connect(capture); tone.start();
    const config = ${JSON.stringify(rtcConfiguration)};
    const peers = [new RTCPeerConnection(config), new RTCPeerConnection(config)];
    const gathered = [[], []];
    const iceErrors = [];
    const candidates = [[], []];
    const errors = [];
    const receive = peers.map((peer, index) => createSignalQueue(async (message) => {
      if (message.type === 'candidate') {
        if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
        else candidates[index].push(message.candidate);
        return;
      }
      await peer.setRemoteDescription(message.sdp);
      for (const candidate of candidates[index].splice(0)) await peer.addIceCandidate(candidate);
      if (message.type === 'offer') {
        await peer.setLocalDescription(await peer.createAnswer());
        void receive[1-index]({ type: 'answer', sdp: peer.localDescription.toJSON() });
      }
    }, error => errors.push(error.message)));
    peers.forEach((peer, index) => {
      capture.stream.getTracks().forEach(track => peer.addTrack(track, capture.stream));
      peer.onicecandidate = event => {
        if (event.candidate) {
          gathered[index].push(event.candidate.type);
          void receive[1-index]({ type: 'candidate', candidate: event.candidate.toJSON() });
        }
      };
      peer.onicecandidateerror = event => iceErrors.push({ peer: index, code: event.errorCode });
    });
    await peers[0].setLocalDescription(await peers[0].createOffer());
    await receive[1]({ type: 'offer', sdp: peers[0].localDescription.toJSON() });
    let received = [0,0];
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline && received.some(bytes => bytes === 0)) {
      await new Promise(resolve => setTimeout(resolve, 100));
      for (let i=0; i<peers.length; i++) {
        const stats = await peers[i].getStats();
        stats.forEach(stat => { if (stat.type === 'inbound-rtp' && stat.kind === 'audio') received[i] = stat.bytesReceived; });
      }
    }
    const states = peers.map(peer => peer.connectionState);
    peers.forEach(peer => peer.close()); tone.stop(); await context.close();
    return { received, states, errors, gathered, iceErrors };
  })()`,
    },
    sessionId,
  );
  if (result.exceptionDetails)
    throw new Error(JSON.stringify(result.exceptionDetails));
  const data = result.result.value;
  if (navigation) {
    assert.equal(data.elementStable, true);
    assert.equal(data.streamStable, true);
    assert.equal(data.playbackUninterrupted, true);
    assert.equal(data.audioElements, 1);
    assert.equal(data.trackState, "live");
    console.log(
      "Friends/server navigation audio passed:",
      JSON.stringify(data),
    );
  } else {
    console.log(
      "WebRTC connectivity result:",
      JSON.stringify({
        mode: useTurn
          ? directIp
            ? "TURN via configured server IP"
            : "TURN via hostname"
          : "direct",
        ...data,
      }),
    );
    assert.deepEqual(data.errors, []);
    assert.deepEqual(data.states, ["connected", "connected"]);
    assert.ok(
      data.received.every((bytes) => bytes > 0),
      "Both browsers must receive audio RTP bytes",
    );
    console.log(
      "Real browser direct WebRTC audio passed:",
      JSON.stringify(data),
    );
  }
} finally {
  socket?.close();
  browser.kill();
  await new Promise((resolve) =>
    browser.exitCode !== null ? resolve() : browser.once("exit", resolve),
  );
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  }).catch(() => {});
}
