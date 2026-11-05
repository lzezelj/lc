import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Public library code, generated into the standalone build; contains no audio.
export const dynamic = "force-static";
export async function GET() {
  const directory = join(process.cwd(), "node_modules/@shiguredo/rnnoise-wasm");
  const [source, license, rnnoiseLicense] = await Promise.all([
    readFile(join(directory, "dist/rnnoise.js"), "utf8"),
    readFile(join(directory, "LICENSE"), "utf8"),
    readFile(join(process.cwd(), "server/rnnoise-LICENSE.txt"), "utf8"),
  ]);
  return new Response(`/* ${license}\n${rnnoiseLicense} */\n${source}`, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
