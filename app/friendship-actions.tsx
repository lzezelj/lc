"use client";
import { useState } from "react";

export function FriendshipActions({
  name,
  onAddFriend,
  onAcceptFriend,
  onRemoveFriend,
  requestPending = false,
  unavailable = false,
}: {
  name: string;
  onAddFriend?: () => Promise<void>;
  onAcceptFriend?: () => Promise<void>;
  onRemoveFriend?: () => Promise<void>;
  requestPending?: boolean;
  unavailable?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setConfirm(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Friend action failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profileActions friendshipActions">
      {unavailable ? (
        <small>Demo accounts cannot send friend requests.</small>
      ) : onRemoveFriend ? (
        <>
          {confirm && (
            <p>
              Remove {name} from your friends? Your message history will be
              kept.
            </p>
          )}
          {confirm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirm(false);
                setError("");
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() =>
              confirm ? void run(onRemoveFriend) : setConfirm(true)
            }
          >
            {busy
              ? "Removing…"
              : confirm
                ? "Confirm remove friend"
                : "Remove friend"}
          </button>
        </>
      ) : onAcceptFriend ? (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void run(onAcceptFriend)}
        >
          {busy ? "Accepting…" : "Accept friend request"}
        </button>
      ) : requestPending ? (
        <button type="button" disabled>
          Friend request sent
        </button>
      ) : onAddFriend ? (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() => void run(onAddFriend)}
        >
          {busy ? "Sending request…" : "Add friend"}
        </button>
      ) : null}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
