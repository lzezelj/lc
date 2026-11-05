"use client";

export function WorkspaceLinks({
  onLegal,
  onHelp,
}: {
  onLegal: (document: "impressum" | "privacy" | "licenses") => void;
  onHelp: () => void;
}) {
  return (
    <footer className="appLegalLinks">
      <button type="button" onClick={() => onLegal("impressum")}>
        Impressum
      </button>
      <button type="button" onClick={() => onLegal("privacy")}>
        Privacy
      </button>
      <button type="button" onClick={() => onLegal("licenses")}>
        Licenses
      </button>
      <button
        type="button"
        className="helpTrigger"
        aria-label="Help and introduction"
        onClick={onHelp}
      >
        Help & introduction
      </button>
    </footer>
  );
}
