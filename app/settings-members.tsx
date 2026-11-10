"use client";
import { useState } from "react";
export function SettingsMembers({
  members,
  onTransfer,
  onRoleChange,
}: {
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
}) {
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = members.filter((member) =>
    `${member.name} ${member.role === "mod" ? "moderator mod" : member.role}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <section>
      <h3>Members</h3>
      <label>
        Search members
        <input
          type="search"
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
            <strong>{member.name}</strong>
            <small>{member.role === "mod" ? "moderator" : member.role}</small>
            <div className="settingsMemberActions">
              {onRoleChange &&
                member.role !== "owner" &&
                member.canBeModerator !== false && (
                  <button
                    type="button"
                    className="transferOwnershipButton"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      setCandidate("");
                      try {
                        await onRoleChange(
                          member,
                          member.role === "mod" ? "member" : "mod",
                        );
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
                  >
                    {member.role === "mod"
                      ? "Demote to member"
                      : "Promote to moderator"}
                  </button>
                )}
              {onTransfer && member.role !== "owner" && (
                <button
                  type="button"
                  className="transferOwnershipButton"
                  disabled={busy}
                  onClick={() => {
                    setCandidate(member.id);
                    setError("");
                  }}
                >
                  Promote to owner
                </button>
              )}
            </div>
            {candidate === member.id && (
              <div className="ownershipConfirmation settingsDangerZone">
                <p>
                  Transfer ownership to <strong>{member.name}</strong>? You will
                  become a regular member and lose owner controls. Only the new
                  owner can transfer it back.
                </p>
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
                        await onTransfer!(member);
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
                    {busy ? "Transferring…" : "Confirm transfer ownership"}
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
    </section>
  );
}
