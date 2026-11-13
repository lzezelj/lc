import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";
export const metadata: Metadata = { title: "Licenses | LZRelay" };

export default async function LicensesPage() {
  const [projectLicense, rnnoise, wrapper] = await Promise.all([
    readFile(join(process.cwd(), "LICENSE"), "utf8"),
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
          Back to LZRelay
        </Link>
        <h1>Licenses</h1>
        <section>
          <h2>LZRelay personal-use license</h2>
          <p>
            Personal use and private modifications for friends-only hosting are
            permitted. Commercial use and redistribution require prior written
            permission. The full terms below apply to the original project;
            third-party components retain their own licenses.
          </p>
          <pre className="licenseText">{projectLicense}</pre>
        </section>
        <h2>Third-party licenses</h2>
        <p>
          LZRelay uses the following open-source software for local microphone
          noise suppression. These notices are hosted here independently of the
          LZRelay source repository.
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
