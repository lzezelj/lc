"use client";

import { SettingsModal } from "./settings-modal";
import { formatUserHandle } from "../user-handle";
import { useState } from "react";
import { Avatar } from "./avatar";

export type ProfileUser = {
  id: string;
  name: string;
  image?: string | null;
  handle?: string | null;
  role?: string;
};

export function UserProfile({
  user,
  status,
  mutualServers,
  onClose,
  onMessage,
  onEditProfile,
  onAddFriend,
  onAcceptFriend,
  onRemoveFriend,
  requestPending = false,
  friendActionsUnavailable = false,
}: {
  user: ProfileUser;
  status: string;
  mutualServers: string[];
  onClose: () => void;
  onMessage?: () => void;
  onEditProfile?: () => void;
  onAddFriend?: () => Promise<void>;
  onAcceptFriend?: () => Promise<void>;
  onRemoveFriend?: () => Promise<void>;
  requestPending?: boolean;
  friendActionsUnavailable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  async function updateFriendship(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Friend request failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsModal
      title="User profile"
      className="userProfileModal"
      onClose={onClose}
    >
      <div className="profileBanner" aria-hidden="true">
        <span>LC</span>
      </div>
      <div className="profileDetails">
        <Avatar name={user.name} image={user.image} className="profileAvatar" />
        <h3>{user.name}</h3>
        {user.handle && <p>{formatUserHandle(user.handle)}</p>}
        <p className="profilePresence">
          <i
            className={`statusDot status-${status === "Do not disturb" ? "dnd" : status.toLowerCase()}`}
            aria-hidden="true"
          />
          {status}
        </p>
        {user.role && <span className="profileRole">{user.role}</span>}
        {!onEditProfile && (
          <section>
            <h4>Shared server</h4>
            {mutualServers.length ? (
              mutualServers.map((name) => <p key={name}>{name}</p>)
            ) : (
              <p>No shared server in this view.</p>
            )}
          </section>
        )}
        <div className="profileActions">
          {onEditProfile ? (
            <button className="primary" type="button" onClick={onEditProfile}>
              Edit profile
            </button>
          ) : onAcceptFriend ? (
            <button
              className="primary"
              disabled={busy}
              type="button"
              onClick={() => void updateFriendship(onAcceptFriend)}
            >
              {busy ? "Accepting…" : "Accept friend request"}
            </button>
          ) : requestPending ? (
            <button type="button" disabled>
              Friend request sent
            </button>
          ) : onAddFriend ? (
            <button
              className="primary"
              disabled={busy}
              type="button"
              onClick={() => void updateFriendship(onAddFriend)}
            >
              {busy ? "Sending request…" : "Add friend"}
            </button>
          ) : null}
          {onMessage && (
            <button className="primary" type="button" onClick={onMessage}>
              Message
            </button>
          )}
          {onMessage && !onRemoveFriend && !onEditProfile && (
            <small>Not friends</small>
          )}
          {onRemoveFriend && (
            <div className={confirmRemoval ? "settingsDangerZone" : undefined}>
              {confirmRemoval && (
                <p>
                  Remove {user.name} from your friends? Your message history
                  will be kept.
                </p>
              )}
              {confirmRemoval && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmRemoval(false)}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => {
                  if (!confirmRemoval) setConfirmRemoval(true);
                  else void updateFriendship(onRemoveFriend);
                }}
              >
                {busy
                  ? "Removing…"
                  : confirmRemoval
                    ? "Confirm remove friend"
                    : "Remove friend"}
              </button>
            </div>
          )}
          {friendActionsUnavailable && (
            <small>Demo accounts cannot send friend requests.</small>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </SettingsModal>
  );
}
