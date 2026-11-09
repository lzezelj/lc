"use client";
import { useState } from "react";
import { Avatar } from "./avatar";
import { LoadingSkeleton } from "./loading-skeleton";
import type { useServerInvitations } from "./use-server-invitations";

export function PendingServerInvitations({
  invitations,
  incoming,
}: {
  invitations: ReturnType<typeof useServerInvitations>;
  incoming?: boolean;
}) {
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  return (
    <section
      className="pendingServerInvitations"
      aria-label="Server invitations"
    >
      {!invitations.ready && <LoadingSkeleton kind="reactions" />}
      {(error || invitations.error) && (
        <p role="alert">
          {error || invitations.error}{" "}
          <button type="button" onClick={() => void invitations.refresh()}>
            Retry
          </button>
        </p>
      )}
      {invitations.rows.some(
        (invite) => incoming === undefined || invite.incoming === incoming,
      ) && <p className="sectionLabel">SERVER INVITATIONS</p>}
      {invitations.rows
        .filter(
          (invite) => incoming === undefined || invite.incoming === incoming,
        )
        .map((invite) => (
          <div className="friendRow" key={invite.id}>
            <Avatar
              name={invite.serverName}
              image={invite.serverImage}
              className="serverPicture"
              showPlaceholder
            />
            <span className="serverInvitationIdentity">
              <b title={invite.serverName}>{invite.serverName}</b>
              <small>
                {invite.incoming
                  ? `${invite.inviterName} invited you`
                  : `Invited ${invite.recipientName} · Sent`}
              </small>
            </span>
            {(invite.incoming
              ? (["accept", "decline"] as const)
              : (["cancel"] as const)
            ).map((action) => (
              <button
                type="button"
                key={action}
                className={action === "accept" ? "" : "danger"}
                disabled={!!busy}
                onClick={async () => {
                  setBusy(invite.id);
                  setError("");
                  try {
                    await invitations.act(invite, action);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Invitation could not be updated.",
                    );
                  } finally {
                    setBusy("");
                  }
                }}
              >
                {action === "accept"
                  ? "Accept"
                  : action === "decline"
                    ? "Decline"
                    : "Cancel invite"}
              </button>
            ))}
          </div>
        ))}
    </section>
  );
}
