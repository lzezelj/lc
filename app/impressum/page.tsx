import type { Metadata } from "next";
import Link from "next/link";
import { getLegalDetails } from "../legal-details";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Impressum | LC",
};

export default function ImpressumPage() {
  const legal = getLegalDetails();

  return (
    <main className="legalPage">
      <article className="legalDocument">
        <Link className="legalBack" href="/">
          ← Back to LC
        </Link>
        <h1>Impressum</h1>
        <p>Information pursuant to § 5 DDG and § 18 MStV.</p>

        <section>
          <h2>Service provider</h2>
          <address>
            <strong>{legal.name}</strong>
            <br />
            {legal.streetAddress}
            <br />
            {legal.postalCity}
            <br />
            {legal.country}
          </address>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Email: <a href={`mailto:${legal.email}`}>{legal.email}</a>
          </p>
        </section>

        <section>
          <h2>Content responsibility</h2>
          <p>
            Responsible for the content of this service: {legal.name}, at the
            address stated above. LC is a private portfolio and demonstration
            project and does not provide journalistic-editorial content.
          </p>
        </section>

        <footer className="legalDocumentFooter">
          <Link href="/privacy">Privacy notice</Link>
        </footer>
      </article>
    </main>
  );
}
