"use client";

import { useState } from "react";

export function MessageDeleteAction({
  label,
  confirmation,
  onDelete,
}: {
  label: string;
  confirmation: string;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="messageBulkDelete">
      {confirming ? (
        <div className="settingsDangerZone">
          <p>{confirmation}</p>
          {error && <p role="alert">{error}</p>}
          <div className="managedChannelActions">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onDelete();
                  setConfirming(false);
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Messages could not be deleted.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Confirm delete messages"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="danger"
          onClick={() => setConfirming(true)}
        >
          {label}
        </button>
      )}
    </div>
  );
}
