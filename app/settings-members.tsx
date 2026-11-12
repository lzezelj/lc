"use client";
import { SettingsSection } from "./settings-section";
import { useState } from "react";
import { PromotionMenu } from "./promotion-menu";
import { compareServerMembers } from "./member-order";
export function SettingsMembers({
  members,
  currentUserId,
  onTransfer,
  onRoleChange,
  onKick,
}: {
  currentUserId: string;
  members: {
    id: string;
    name: string;
    role: string;
    canBeModerator?: boolean;
  }[];
  onTransfer?: (member: {
    id: string;
    name: string;
    role: string;
  }) => Promise<void>;
  onRoleChange?: (
    member: { id: string; name: string; role: string },
    role: "member" | "mod",
  ) => Promise<void>;
  onKick?: (member: {
    id: string;
    name: string;
    role: string;
  }) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState("");
  const [kicking, setKicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = members
    .filter((member) =>
      `${member.name} ${member.role === "mod" ? "moderator mod" : member.role}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort(compareServerMembers);
  return (
    <SettingsSection
      title="Members"
      className="settingsMembers"
      hint="Search server members and manage their access and roles."
    >
      <label>
        Search members
        <input
          type="search"
          placeholder="Search members"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && !candidate && <p role="alert">{error}</p>}
      <div className="settingsMemberList">
        {visible.map((member) => (
          <div className="settingsMemberRow" key={member.id}>
            <span className="inviteAvatar" aria-hidden="true">
              {member.name[0]?.toUpperCase()}
            </span>
            <strong>
              {member.name}
              {member.id === currentUserId ? " (You)" : ""}{" "}
              <small>
                ({member.role === "mod" ? "moderator" : member.role})
              </small>
            </strong>
            <div className="settingsMemberActions">
              {(onRoleChange || onTransfer) && member.role !== "owner" && (
                <PromotionMenu
                  name={member.name}
                  disabled={busy}
                  moderatorDisabled={
                    !onRoleChange ||
                    member.role === "mod" ||
                    member.canBeModerator === false
                  }
                  ownerDisabled={!onTransfer}
                  canDemote={member.role === "mod" && !!onRoleChange}
                  onSelect={async (role) => {
                    if (role === "owner") {
                      setKicking(false);
                      setCandidate(member.id);
                      setError("");
                      return;
                    }
                    setBusy(true);
                    setError("");
                    setCandidate("");
                    try {
                      await onRoleChange?.(member, role);
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "The member's role could not be changed.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              )}
              {onKick && member.role !== "owner" && (
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={() => {
                    setKicking(true);
                    setCandidate(member.id);
                    setError("");
                  }}
                >
                  Kick
                </button>
              )}
            </div>
            {candidate === member.id && (
              <div className="ownershipConfirmation settingsDangerZone">
                {kicking ? (
                  <p>
                    Kick <strong>{member.name}</strong>? They will immediately
                    lose server access and be disconnected from its voice
                    channels.
                  </p>
                ) : (
                  <p>
                    Transfer ownership to <strong>{member.name}</strong>? You
                    will become a regular member and lose owner controls. Only
                    the new owner can transfer it back.
                  </p>
                )}
                {error && <p role="alert">{error}</p>}
                <div className="managedChannelActions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCandidate("")}
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
                        if (kicking) await onKick!(member);
                        else await onTransfer!(member);
                        setCandidate("");
                      } catch (failure) {
                        setError(
                          failure instanceof Error
                            ? failure.message
                            : "Ownership could not be transferred.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy
                      ? "Saving…"
                      : kicking
                        ? "Kick from server"
                        : "Confirm transfer ownership"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {!visible.length && (
        <p className="empty">No members match this search.</p>
      )}
    </SettingsSection>
  );
}
