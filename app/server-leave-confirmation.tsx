"use client";
import { useRef, useState } from "react";
import { SettingsModal } from "./settings-modal";

export function ServerLeaveConfirmation({
  server,
  onConfirm,
  onClose,
}: {
  server: { id: string; name: string };
  onConfirm: (serverId: string) => Promise<void>;
  onClose: () => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <SettingsModal
      title="Leave server?"
      closeLabel="Cancel leaving server"
      className="deletionConfirmation"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <p>
        Are you sure you want to leave <b>{server.name}</b>? You will need a new
        invitation to rejoin.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="modalActions">
        <button type="button" autoFocus disabled={busy} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={async () => {
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            try {
              await onConfirm(server.id);
              onClose();
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not leave the server.",
              );
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        >
          {busy ? "Leaving…" : "Leave server"}
        </button>
      </div>
    </SettingsModal>
  );
}
