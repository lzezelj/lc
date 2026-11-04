"use client";

import { useEffect, useRef } from "react";

export function VoiceTransferDialog({ onClose }: { onClose: () => void }) {
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    confirmButton.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
    };
  }, []);

  return (
    <div className="modalBackdrop deletionConfirmationBackdrop">
      <section
        className="modalCard deletionConfirmation"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="voice-transfer-title"
        aria-describedby="voice-transfer-description"
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            event.preventDefault();
            confirmButton.current?.focus();
          }
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 id="voice-transfer-title">Voice connection moved</h2>
        <p id="voice-transfer-description">
          You joined a channel on another device or tab. This voice connection
          was disconnected.
        </p>
        <div className="modalActions">
          <button ref={confirmButton} className="primary" onClick={onClose}>
            OK
          </button>
        </div>
      </section>
    </div>
  );
}
