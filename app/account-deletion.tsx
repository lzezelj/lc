"use client";
import { useState } from "react";

export function AccountDeletion({ onDeleted }: { onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false),
    [confirmation, setConfirmation] = useState("");
  const [deleteMessages, setDeleteMessages] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="settingsDangerZone accountDeletion">
      <h3>Delete account</h3>
      <p>
        Remove your profile, sign-in links, friendships and server memberships.
        Retained messages appear as Deleted user. Transfer or delete any servers
        you own first.
      </p>
      {!confirming ? (
        <button
          type="button"
          className="danger"
          onClick={() => setConfirming(true)}
        >
          Delete my account
        </button>
      ) : (
        <>
          <label className="inlineCheckbox">
            <input
              type="checkbox"
              checked={deleteMessages}
              onChange={(event) => setDeleteMessages(event.target.checked)}
              disabled={busy}
            />
            Also permanently delete all messages I sent, including direct
            messages
          </label>
          <label>
            Type DELETE to confirm
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              disabled={busy}
              autoComplete="off"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="managedChannelActions">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              className="danger"
              type="button"
              disabled={busy || confirmation !== "DELETE"}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await fetch("/api/users/me", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      confirm: confirmation,
                      deleteMessages,
                    }),
                  });
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(
                      data.error ?? "Account could not be deleted.",
                    );
                  onDeleted();
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "Account could not be deleted.",
                  );
                  setBusy(false);
                }
              }}
            >
              {busy ? "Deleting…" : "Permanently delete account"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
