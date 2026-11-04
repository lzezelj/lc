"use client";

import { SettingsModal } from "./settings-modal";
import { formatUserHandle } from "../user-handle";
import { useState } from "react";

export type ProfileUser = {
  id: string;
  name: string;
  handle?: string;
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
  requestPending?: boolean;
  friendActionsUnavailable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
        <span className="avatar profileAvatar" aria-hidden="true">
          {user.name[0]?.toUpperCase()}
        </span>
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
          ) : onMessage ? (
            <button className="primary" type="button" onClick={onMessage}>
              Message
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
          {friendActionsUnavailable && (
            <small>Demo accounts cannot send friend requests.</small>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </SettingsModal>
  );
}
