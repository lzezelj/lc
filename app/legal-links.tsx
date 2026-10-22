import Link from "next/link";

export function LegalLinks() {
  return (
    <nav className="legalLinks" aria-label="Legal information">
      <Link href="/impressum">Impressum</Link>
      <Link href="/privacy">Privacy</Link>
    </nav>
  );
}
