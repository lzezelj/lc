import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const children = [
  spawn(process.execPath, [nextBin, "dev"], { stdio: "inherit" }),
  spawn(process.execPath, ["server/signaling.mjs"], { stdio: "inherit" }),
];

function stop() {
  for (const child of children) child.kill();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      stop();
      process.exitCode = code;
    }
  });
}
