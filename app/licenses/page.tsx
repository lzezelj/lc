import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Third-party licenses | LC" };

export default async function LicensesPage() {
  const [rnnoise, wrapper] = await Promise.all([
    readFile(join(process.cwd(), "server/rnnoise-LICENSE.txt"), "utf8"),
    readFile(
      join(process.cwd(), "node_modules/@shiguredo/rnnoise-wasm/LICENSE"),
      "utf8",
    ),
  ]);
  return (
    <main className="legalPage">
      <article className="legalDocument">
        <Link className="legalBack" href="/">
          Back to LC
        </Link>
        <h1>Third-party licenses</h1>
        <p>
          LC uses the following open-source software for local microphone noise
          suppression. These notices are hosted here independently of the LC
          source repository.
        </p>
        <section>
          <h2>RNNoise</h2>
          <p>
            Noise suppression by{" "}
            <a href="https://github.com/xiph/rnnoise">RNNoise</a>.
          </p>
          <pre className="licenseText">{rnnoise}</pre>
        </section>
        <section>
          <h2>@shiguredo/rnnoise-wasm</h2>
          <p>
            WebAssembly integration by{" "}
            <a href="https://github.com/shiguredo/rnnoise-wasm">Shiguredo</a>,
            version 2025.1.5.
          </p>
          <pre className="licenseText">{wrapper}</pre>
        </section>
      </article>
    </main>
  );
}
