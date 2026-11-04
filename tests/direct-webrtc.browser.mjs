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
const microphone = process.argv.includes("--microphone");
const helpTourOnly = process.argv.includes("--help-tour");
const messageComposerOnly = process.argv.includes("--message-composer");
const chatToolsOnly = process.argv.includes("--chat-tools");
const notificationsOnly = process.argv.includes("--notifications");
const workspaceControls =
  process.argv.includes("--workspace-controls") ||
  helpTourOnly ||
  messageComposerOnly ||
  chatToolsOnly ||
  notificationsOnly;
const mediaOptionsOnly =
  process.argv.includes("--media-options-only") || helpTourOnly;
const supportedFlags = new Set([
  "--turn",
  "--direct-ip",
  "--navigation",
  "--microphone",
  "--workspace-controls",
  "--media-options-only",
  "--help-tour",
  "--message-composer",
  "--chat-tools",
  "--notifications",
]);
if (process.argv.slice(2).some((flag) => !supportedFlags.has(flag)))
  throw new Error("Unsupported browser test option");
if (mediaOptionsOnly && !workspaceControls)
  throw new Error("--media-options-only requires --workspace-controls");
if ([navigation, microphone, workspaceControls].filter(Boolean).length > 1)
  throw new Error("Choose only one browser test mode");
if (useTurn && (navigation || microphone || workspaceControls))
  throw new Error("TURN options apply only to the connectivity test");
if (directIp && !useTurn) throw new Error("--direct-ip requires --turn");
let rtcConfiguration = {};
if (useTurn) {
  const local = parse(await readFile(new URL("../.env", import.meta.url)));
  const config = { ...local, ...process.env };
  if (!config.TURN_SECRET || !config.TURN_URLS)
    throw new Error("TURN configuration is missing");
  if (directIp && !config.TURN_EXTERNAL_IP)
    throw new Error("TURN_EXTERNAL_IP is required for --direct-ip");
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
if (navigation || workspaceControls) {
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
  for (const name of [
    "workspace-shell",
    ...(navigation
      ? ["device-menu", "device-selection", "call-tile-controls"]
      : []),
  ]) {
    await writeFile(
      join(directory, `${name}.js`),
      ts.transpile(
        await readFile(new URL(`../app/${name}.tsx`, import.meta.url), "utf8"),
        {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      ),
    );
  }
  if (navigation) {
    const groupSource = await readFile(
      new URL("../app/group-call.tsx", import.meta.url),
      "utf8",
    );
    const groupAst = ts.createSourceFile(
      "group-call.tsx",
      groupSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const components = groupAst.statements
      .filter(
        (node) =>
          ts.isFunctionDeclaration(node) &&
          ["GroupCall", "RemoteTrackView"].includes(node.name?.text),
      )
      .map((node) => node.getText(groupAst).replace(/^export /, ""))
      .join("\n");
    await writeFile(
      join(directory, "group-navigation.mock.mjs"),
      await readFile(
        new URL("./group-navigation.mock.mjs", import.meta.url),
        "utf8",
      ),
    );
    await writeFile(
      join(directory, "group-call-probe.js"),
      ts.transpile(
        `
      import React, {useState, useRef, useEffect} from 'react';
      import {Room, RoomEvent, Track, TrackEvent} from './group-navigation.mock.mjs';
      import {DeviceMenu} from './device-menu.js';
      import {applyRemoteAudioVolume} from './remote-audio-volume.js';
      import {HideTileButton, HiddenTilesMenu, SelfViewButton} from './call-tile-controls.js';
      const fetch = async () => ({ok: true, json: async () => ({server_url: 'test', participant_token: 'test'})});
      const prepareVoiceActivity = () => window.groupNavigation.context;
      const playVoiceSound = () => {};
      const voiceCaptureOptions = () => ({});
      const monitorRoomDiagnostics = () => () => {};
      const monitorTrackVideo = () => () => {};
      const videoQuality = () => '';
      const useSoundboard = () => ({player: useRef(null), volume: 100, muted: false});
      const SoundboardButton = () => null;
      ${components}
      export {GroupCall};
    `,
        {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      ),
    );
  }
  if (workspaceControls) {
    await writeFile(
      join(directory, "user-handle.js"),
      ts.transpile(
        await readFile(new URL("../user-handle.ts", import.meta.url), "utf8"),
        { module: ts.ModuleKind.CommonJS },
      ),
    );
    for (const name of [
      "settings-modal",
      "help-tour",
      "help-call-preview",
      "help-spotlight",
      "loading-skeleton",
      "settings-navigation",
      "personal-messages",
      "account-deletion",
      "settings-members",
      "settings-reveal",
      "server-invites",
      "channel-manager",
      "message-delete-action",
      "chat-history",
      "stream-info",
      "stream-volume",
      "soundboard",
      "sound-manager",
      "server-nav-button",
      "voice-participant-menu",
      "incoming-call-notice",
      "screen-audio",
      "screen-share-options",
      "camera-resolution",
      "empty-state",
      "use-message-cooldown",
      "message-composer",
      "conversation-search",
      "workspace-links",
      "unread-indicator",
      "mention-text",
      "notification-settings",
      "message-attachments",
      "message-header",
      "user-profile",
      "sidebar-resizer",
      "device-menu",
      "participant-media-indicators",
      "panel-toggle",
      "device-selection",
      "audio-device-options",
      "user-status-menu",
    ]) {
      await writeFile(
        join(directory, `${name}.js`),
        ts.transpile(
          await readFile(
            new URL(`../app/${name}.tsx`, import.meta.url),
            "utf8",
          ),
          {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.ReactJSX,
          },
        ),
      );
    }
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
    const diagnostics = ast.statements.find(
      (node) =>
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "DiagnosticsIndicator",
    );
    await writeFile(
      join(directory, "diagnostics.js"),
      ts.transpile(
        `import { useState, useEffect, useId } from 'react';\n${diagnostics.getText(ast)}\nexport { DiagnosticsIndicator };`,
        {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      ),
    );
  }
  for (const name of [
    "remote-audio-volume",
    ...(workspaceControls
      ? [
          "soundboard-audio",
          "soundboard-library",
          "workspace-activity",
          "use-workspace-activity",
          "call-context",
          "attachment-types",
          "mentions",
          "notification-types",
          "use-notification-inbox",
          "help-geometry",
          "voice-activity",
          "audio-output",
          "soundboard-catalog",
        ]
      : []),
  ]) {
    await writeFile(
      join(directory, `${name}.js`),
      ts.transpile(
        await readFile(
          new URL(
            name === "soundboard-catalog"
              ? "./sound-wave.ts"
              : `../app/${name}.ts`,
            import.meta.url,
          ),
          "utf8",
        ),
        { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      ),
    );
  }
  await writeFile(
    join(directory, "entry.mjs"),
    await readFile(
      new URL(
        workspaceControls
          ? "./workspace-controls.fixture.mjs"
          : "./call-navigation.fixture.mjs",
        import.meta.url,
      ),
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
        alias: { "../user-handle": join(directory, "user-handle.js") },
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
    "--mute-audio",
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
  const gateCode = microphone
    ? ts
        .transpile(
          await readFile(
            new URL("../app/microphone-gate.ts", import.meta.url),
            "utf8",
          ),
          { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        )
        .replace(/^export /gm, "")
    : "";
  if (workspaceControls)
    await call(
      "Emulation.setDeviceMetricsOverride",
      { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
  const workspaceStyles = workspaceControls
    ? await readFile(new URL("../app/globals.css", import.meta.url), "utf8")
    : "";
  const result = await call(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      userGesture: true,
      returnByValue: true,
      timeout: 20000,
      expression: workspaceControls
        ? `const css = document.createElement('style'); css.textContent = ${JSON.stringify(workspaceStyles)}; document.head.append(css); ${navigationCode}; window.setupWorkspaceControlsTest()`
        : microphone
          ? `(async () => {
        let threshold = '-45';
        const localStorage = { getItem: (key) => key === 'lc.voiceThreshold' ? threshold : null };
        ${gateCode}
        const context = new AudioContext(); await context.resume();
        const oscillator = context.createOscillator();
        const volume = context.createGain(); volume.gain.value = 0.0001;
        const capture = context.createMediaStreamDestination();
        oscillator.connect(volume); volume.connect(capture); oscillator.start();
        const gate = createMicrophoneGate(capture.stream.getAudioTracks()[0], context);
        const source = context.createMediaStreamSource(new MediaStream([gate.track]));
        const analyser = context.createAnalyser(); analyser.fftSize = 2048;
        source.connect(analyser);
        const values = new Float32Array(analyser.fftSize);
        const readLevel = async () => { await new Promise(resolve => setTimeout(resolve, 450)); analyser.getFloatTimeDomainData(values); return Math.sqrt(values.reduce((sum, sample) => sum + sample * sample, 0) / values.length); };
        const quiet = await readLevel();
        volume.gain.value = 0.1;
        const speech = await readLevel();
        threshold = '0';
        const blocked = await readLevel();
        threshold = '-80'; volume.gain.value = 0.0001;
        const disabled = await readLevel();
        gate.stop(); oscillator.stop(); capture.stream.getTracks().forEach(track => track.stop());
        const stopped = gate.track.readyState;
        await context.close();
        return { quiet, speech, blocked, disabled, stopped };
      })()`
          : navigation
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
  if (messageComposerOnly || chatToolsOnly || notificationsOnly) {
    for (const mobile of [false, true]) {
      if (mobile) {
        await call(
          "Emulation.setDeviceMetricsOverride",
          { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
          sessionId,
        );
        await call(
          "Emulation.setEmulatedMedia",
          { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
          sessionId,
        );
      }
      const checked = await call(
        "Runtime.evaluate",
        {
          expression: notificationsOnly
            ? "(async () => { await window.verifyWorkspaceActivity(); return window.verifyNotifications(); })()"
            : chatToolsOnly
              ? "window.verifyChatTools()"
              : "(async () => ({composer: await window.verifyMessageComposer(), attachments: await window.verifyAttachmentPreview()}))()",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (checked.exceptionDetails)
        throw new Error(JSON.stringify(checked.exceptionDetails));
      console.log(
        `Message composer ${mobile ? "mobile" : "desktop"} passed:`,
        JSON.stringify(checked.result.value),
      );
    }
  } else if (workspaceControls) {
    await call(
      "Input.dispatchMouseEvent",
      { type: "mouseMoved", x: data.x, y: data.y },
      sessionId,
    );
    await call(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x: data.x,
        y: data.y,
        button: "left",
        clickCount: 1,
      },
      sessionId,
    );
    await call(
      "Input.dispatchMouseEvent",
      {
        type: "mouseMoved",
        x: data.x + 60,
        y: data.y,
        button: "left",
        buttons: 1,
      },
      sessionId,
    );
    await call(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: data.x + 60,
        y: data.y,
        button: "left",
        clickCount: 1,
      },
      sessionId,
    );
    const fullscreenCheck = await call(
      "Runtime.evaluate",
      {
        expression: "window.verifyVideoFullscreen()",
        awaitPromise: true,
        userGesture: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (fullscreenCheck.exceptionDetails)
      throw new Error(JSON.stringify(fullscreenCheck.exceptionDetails));
    console.log(
      "Selected video fullscreen check passed:",
      JSON.stringify(fullscreenCheck.result.value),
    );
    const runWorkspaceCheck = async (verification, viewport) => {
      console.log(`Checking ${verification} (${viewport})`);
      const checked = await call(
        "Runtime.evaluate",
        {
          expression: `window.${verification}()`,
          awaitPromise: true,
          userGesture: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (checked.exceptionDetails)
        throw new Error(JSON.stringify(checked.exceptionDetails));
    };
    for (const verification of [
      "verifyScreenAudioTransport",
      "verifyLiveKitImmediateMute",
      "verifySoundboard",
    ])
      await runWorkspaceCheck(verification, "desktop");
    if (mediaOptionsOnly) {
      for (const mobile of [false, true]) {
        if (mobile)
          await call(
            "Emulation.setDeviceMetricsOverride",
            { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
            sessionId,
          );
        for (const verification of helpTourOnly
          ? ["verifyHelpAndSkeletons"]
          : [
              "verifyWorkspaceAdditions",
              ...(mobile ? ["verifySoundboard"] : []),
              "verifyWorkspaceActivity",
              "verifyCallContext",
              "verifyVoiceParticipantMenu",
              "verifyHelpAndSkeletons",
            ]) {
          for (const type of ["keyDown", "keyUp"])
            await call(
              "Input.dispatchKeyEvent",
              { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
              sessionId,
            );
          const reducedLoading =
            mobile && verification === "verifyHelpAndSkeletons";
          if (reducedLoading)
            await call(
              "Emulation.setEmulatedMedia",
              {
                features: [{ name: "prefers-reduced-motion", value: "reduce" }],
              },
              sessionId,
            );
          try {
            await runWorkspaceCheck(
              verification,
              mobile ? "mobile" : "desktop",
            );
          } finally {
            if (reducedLoading)
              await call(
                "Emulation.setEmulatedMedia",
                { features: [] },
                sessionId,
              );
          }
        }
      }
      console.log("Media options desktop/mobile checks passed");
      const mounted = await call(
        "Runtime.evaluate",
        {
          expression: "window.mountServerTooltipTest()",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (mounted.exceptionDetails)
        throw new Error(JSON.stringify(mounted.exceptionDetails));
      try {
        const point = mounted.result.value;
        await call(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", ...point },
          sessionId,
        );
        const readTooltip = async () => {
          const result = await call(
            "Runtime.evaluate",
            {
              expression:
                "(async () => { await new Promise(resolve => setTimeout(resolve, 180)); return window.readServerTooltipTest(); })()",
              awaitPromise: true,
              returnByValue: true,
            },
            sessionId,
          );
          if (result.exceptionDetails)
            throw new Error(JSON.stringify(result.exceptionDetails));
          return result.result.value;
        };
        assert.equal(
          (await readTooltip()).opacity,
          "1",
          "Hover reveals the server tooltip",
        );
        for (const type of ["mousePressed", "mouseReleased"])
          await call(
            "Input.dispatchMouseEvent",
            { type, ...point, button: "left", clickCount: 1 },
            sessionId,
          );
        await call(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", x: 200, y: 200 },
          sessionId,
        );
        const clicked = await readTooltip();
        assert.equal(
          clicked.focused,
          true,
          "Click keeps keyboard focus on the server button",
        );
        assert.equal(
          clicked.opacity,
          "0",
          "Click must not pin the server tooltip after pointer exit",
        );
        console.log("Server tooltip pointer checks passed");
      } finally {
        await call(
          "Runtime.evaluate",
          { expression: "window.cleanupServerTooltipTest()" },
          sessionId,
        );
      }
      const evaluateTour = async (expression) => {
        const result = await call(
          "Runtime.evaluate",
          { expression, awaitPromise: true, returnByValue: true },
          sessionId,
        );
        if (result.exceptionDetails)
          throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      };
      const dragHelp = await evaluateTour("window.mountMovableHelpTest()");
      try {
        const point = { x: dragHelp.x, y: dragHelp.y };
        await call(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", ...point },
          sessionId,
        );
        await call(
          "Input.dispatchMouseEvent",
          { type: "mousePressed", ...point, button: "left", clickCount: 1 },
          sessionId,
        );
        await call(
          "Input.dispatchMouseEvent",
          {
            type: "mouseMoved",
            x: point.x,
            y: point.y + 60,
            button: "left",
            buttons: 1,
          },
          sessionId,
        );
        await call(
          "Input.dispatchMouseEvent",
          {
            type: "mouseReleased",
            x: point.x,
            y: point.y + 60,
            button: "left",
            clickCount: 1,
          },
          sessionId,
        );
        const moved = await evaluateTour("window.readMovableHelpTest()");
        assert.ok(
          moved.top > dragHelp.top + 40,
          "Dragging the guide header must move the window",
        );
        const advanced = await evaluateTour("window.advanceMovableHelpTest()");
        assert.deepEqual(
          advanced,
          moved,
          "The guide must retain the dragged position after Next",
        );
        console.log("Movable guide pointer checks passed");
      } finally {
        await evaluateTour("window.cleanupMovableHelpTest()");
      }
    } else {
      const checked = await call(
        "Runtime.evaluate",
        {
          expression: "window.verifyWorkspaceControlsTest()",
          awaitPromise: true,
          userGesture: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (checked.exceptionDetails)
        throw new Error(JSON.stringify(checked.exceptionDetails));
      console.log(
        "Workspace controls browser check passed:",
        JSON.stringify(checked.result.value),
      );
      for (const selector of [
        ".voiceDock > .deviceControl:first-of-type > .mediaToggle",
        ".voiceDock > .deviceControl:nth-of-type(2) > .mediaToggle",
        ".voiceDock > button:not(.soundboardPlaceholder)",
        ".soundboardPlaceholder",
      ]) {
        const target = await call(
          "Runtime.evaluate",
          {
            expression: `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
            returnByValue: true,
          },
          sessionId,
        );
        await call(
          "Input.dispatchMouseEvent",
          { type: "mouseMoved", ...target.result.value },
          sessionId,
        );
        const hovered = await call(
          "Runtime.evaluate",
          {
            expression: `(async () => { await new Promise(resolve => setTimeout(resolve, 180)); const element = document.querySelector(${JSON.stringify(selector)}); return { translate: getComputedStyle(element).translate }; })()`,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
        );
        assert.ok(
          Math.abs(
            parseFloat(hovered.result.value.translate.split(/\s+/)[1]) + 2,
          ) < 0.05,
          `${selector} ${JSON.stringify(hovered.result.value)}`,
        );
      }
      console.log(
        "Microphone, camera, sharing and soundboard hover checks passed",
      );
      await call(
        "Emulation.setDeviceMetricsOverride",
        { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
        sessionId,
      );
      const mobile = await call(
        "Runtime.evaluate",
        {
          expression:
            "({ resizerHidden: getComputedStyle(document.querySelector('.sidebarResizer')).display === 'none', noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth })",
          returnByValue: true,
        },
        sessionId,
      );
      assert.equal(mobile.result.value.resizerHidden, true);
      assert.equal(mobile.result.value.noHorizontalOverflow, true);
      await call(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
        sessionId,
      );
      const mobileMicrophone = await call(
        "Runtime.evaluate",
        {
          expression:
            "(async () => { await window.verifyMessageComposer(); await window.verifySettingsAndProfileLayout(); await window.verifyChatHistory(); await window.verifyWorkspaceAdditions(); return window.verifyMicrophonePosition(); })()",
          awaitPromise: true,
          returnByValue: true,
        },
        sessionId,
      );
      if (mobileMicrophone.exceptionDetails)
        throw new Error(JSON.stringify(mobileMicrophone.exceptionDetails));
      console.log(
        "Mobile workspace bounds passed:",
        JSON.stringify(mobile.result.value),
      );
    }
  } else if (microphone) {
    assert.ok(
      data.quiet < 0.000001,
      "Quiet input must be silent at the output",
    );
    assert.ok(data.speech > 0.02, "Speech-level input must pass");
    assert.ok(
      data.blocked < 0.000001,
      "Raising threshold must silence an existing graph",
    );
    assert.ok(
      data.disabled > 0.00001,
      "Disabling the gate must pass quiet input",
    );
    assert.equal(data.stopped, "ended");
    console.log("Real browser microphone gate passed:", JSON.stringify(data));
  } else if (navigation) {
    assert.equal(data.groupRoomPreserved, true);
    assert.equal(data.groupAudioPreserved, true);
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
