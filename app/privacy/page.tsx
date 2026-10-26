import type { Metadata } from "next";
import Link from "next/link";
import { getLegalDetails } from "../legal-details";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Privacy | LC",
};

export default function PrivacyPage() {
  const legal = getLegalDetails();

  return (
    <main className="legalPage">
      <article className="legalDocument">
        <Link className="legalBack" href="/">
          ← Back to LC
        </Link>
        <h1>Privacy notice</h1>
        <p className="legalUpdated">Last updated: 26 October 2026</p>

        <section>
          <h2>1. Controller</h2>
          <address>
            <strong>{legal.name}</strong>
            <br />
            {legal.streetAddress}
            <br />
            {legal.postalCity}
            <br />
            {legal.country}
            <br />
            Email: <a href={`mailto:${legal.email}`}>{legal.email}</a>
          </address>
        </section>

        <section>
          <h2>2. What LC is</h2>
          <p>
            LC is a private, invitation-only portfolio and demonstration project
            for text, voice, and video communication. It is not a public social
            network and is not intended for children.
          </p>
        </section>

        <section>
          <h2>3. Data processed and purposes</h2>
          <ul>
            <li>
              <strong>Account and authentication data:</strong> name, email
              address, profile image, provider identifier, account role, and
              authentication/session information are used to sign users in and
              restrict access.
            </li>
            <li>
              <strong>Demo-account data:</strong> the chosen display name,
              invitation status, expiry time, server membership, and creator are
              used to provide and administer temporary access.
            </li>
            <li>
              <strong>Communication data:</strong> text messages, their authors
              and timestamps, servers, channels, and memberships are stored so
              the chat service works.
            </li>
            <li>
              <strong>Voice and video data:</strong> microphone, camera, and
              screen-sharing media are processed only when enabled by the user
              to provide a call. LC does not intentionally record or store call
              media.
            </li>
            <li>
              <strong>Connection and security data:</strong> IP addresses,
              request metadata, timestamps, and diagnostic information may be
              processed temporarily to deliver the service, maintain network
              connections, prevent abuse, and diagnose failures.
            </li>
          </ul>
        </section>

        <section>
          <h2>4. Voice, video, and WebRTC</h2>
          <p>
            Direct two-person calls use WebRTC and may establish a peer-to-peer
            connection. The other participant can therefore receive network
            connection information, potentially including an IP address. Group
            calls are routed through the self-hosted LiveKit media server on the
            LC infrastructure. Signaling data is exchanged to establish and
            maintain calls. Browser permission is requested before microphone,
            camera, or screen access.
          </p>
        </section>

        <section>
          <h2>5. Legal bases</h2>
          <p>
            Processing required to provide features requested by a participant
            is based on Article 6(1)(b) GDPR where applicable. Operating,
            securing, and demonstrating the project is based on the legitimate
            interests in Article 6(1)(f) GDPR. Optional device access occurs
            only after the user enables it through the application and browser.
          </p>
        </section>

        <section>
          <h2>6. Service providers and recipients</h2>
          <ul>
            <li>
              <strong>Hetzner Online GmbH:</strong> hosts the application,
              database, signaling service, and LiveKit media server in Germany
              and processes the associated account, communication, connection,
              and technical data on our behalf under a data processing agreement
              pursuant to Article 28 GDPR.
            </li>
            <li>
              <strong>Cloudflare, Inc.:</strong> provides DNS, proxy, transport
              security, and protection services and may process connection and
              request metadata.
            </li>
            <li>
              <strong>Google:</strong> provides OAuth authentication for the
              owner account. Google processes data according to its own privacy
              information.
            </li>
            <li>
              <strong>Other call participants:</strong> receive the name,
              presence state, media enabled by the user, and necessary WebRTC
              connection data.
            </li>
          </ul>
          <p>
            Where a provider processes data outside the European Economic Area,
            transfers are handled under the provider&apos;s applicable lawful
            transfer mechanism, such as an adequacy decision or standard
            contractual clauses.
          </p>
        </section>

        <section>
          <h2>7. Cookies and local device storage</h2>
          <p>
            LC uses authentication/session information and browser storage only
            where needed to sign users in, protect accounts, maintain the
            requested service, or remember functional device choices. LC does
            not use advertising or analytics trackers. These technologies are
            treated as strictly necessary for the requested service under § 25
            (2) TDDDG.
          </p>
        </section>

        <section>
          <h2>8. Retention</h2>
          <p>
            Demo invitations expire after four hours. Expiry or revocation
            prevents further access, but related account and invitation records
            may remain until they are manually deleted. Messages, servers,
            channels, memberships, and the owner account are retained while the
            project is operated or until they are deleted. Operational and
            security information is retained only as long as needed for those
            purposes or according to the service provider&apos;s configured
            retention period.
          </p>
        </section>

        <section>
          <h2>9. Your rights</h2>
          <p>
            Subject to the legal requirements, users may request access,
            rectification, erasure, restriction, or portability of their data
            and may object to processing based on legitimate interests. Users
            also have the right to lodge a complaint with a competent data
            protection supervisory authority. Requests can be sent to the email
            address above.
          </p>
        </section>

        <section>
          <h2>10. Automated decisions</h2>
          <p>
            LC does not use automated decision-making or profiling within the
            meaning of Article 22 GDPR.
          </p>
        </section>

        <footer className="legalDocumentFooter">
          <Link href="/impressum">Impressum</Link>
        </footer>
      </article>
    </main>
  );
}
