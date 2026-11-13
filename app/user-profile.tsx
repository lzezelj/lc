"use client";

import { SettingsModal } from "./settings-modal";
import { formatUserHandle } from "../user-handle";
import { FriendshipActions } from "./friendship-actions";
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
  return (
    <SettingsModal
      title="User profile"
      className="userProfileModal"
      onClose={onClose}
    >
      <div className="profileBanner" aria-hidden="true">
        <span>LZR</span>
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
          ) : (
            <FriendshipActions
              key={user.id}
              name={user.name}
              onAddFriend={onAddFriend}
              onAcceptFriend={onAcceptFriend}
              onRemoveFriend={onRemoveFriend}
              requestPending={requestPending}
              unavailable={friendActionsUnavailable}
            />
          )}
          {onMessage && (
            <button className="primary" type="button" onClick={onMessage}>
              Message
            </button>
          )}
          {onMessage && !onRemoveFriend && !onEditProfile && (
            <small>Not friends</small>
          )}
        </div>
      </div>
    </SettingsModal>
  );
}
