"use client";
import { useState } from "react";
export function SettingsMembers({
  members,
  onTransfer,
}: {
  members: { id: string; name: string; role: string }[];
  onTransfer?: (member: {
    id: string;
    name: string;
    role: string;
  }) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [candidate, setCandidate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = members.filter((member) =>
    `${member.name} ${member.role}`
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
      <div className="settingsMemberList">
        {visible.map((member) => (
          <div className="settingsMemberRow" key={member.id}>
            <span className="inviteAvatar" aria-hidden="true">
              {member.name[0]?.toUpperCase()}
            </span>
            <strong>{member.name}</strong>
            <small>{member.role}</small>
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
