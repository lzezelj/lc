"use client";

import { useState } from "react";
import { SettingsNameForm } from "./settings-modal";

type ManagedChannel = {
  id: string;
  name: string;
  type: "text" | "voice_direct" | "voice_group";
};
export function ChannelManager({
  channels,
  onRename,
  onDelete,
}: {
  channels: ManagedChannel[];
  onRename: (channel: ManagedChannel, name: string) => Promise<void>;
  onDelete: (channel: ManagedChannel) => Promise<void>;
}) {
  const [editing, setEditing] = useState("");
  const [deleting, setDeleting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="channelManager">
      {channels.length === 0 && (
        <p className="empty">No channels yet. Create one below.</p>
      )}
      {channels.map((channel) => (
        <section className="managedChannel" key={channel.id}>
          <div className="managedChannelHeading">
            <div>
              <strong>{channel.name}</strong>
              <small>
                {channel.type === "text"
                  ? "Text"
                  : channel.type === "voice_group"
                    ? "Group voice"
                    : "Direct voice"}
              </small>
            </div>
            <div className="managedChannelActions">
              <button
                type="button"
                disabled={busy}
                aria-expanded={editing === channel.id}
                onClick={() => {
                  setEditing(editing === channel.id ? "" : channel.id);
                  setDeleting("");
                  setError("");
                }}
              >
                Rename
              </button>
              <button
                className="danger"
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleting(channel.id);
                  setEditing("");
                  setError("");
                }}
              >
                Delete
              </button>
            </div>
          </div>
          {editing === channel.id && (
            <SettingsNameForm
              key={channel.name}
              name={channel.name}
              label="Channel name"
              onSave={(name) => onRename(channel, name)}
            />
          )}
          {deleting === channel.id && (
            <div className="settingsDangerZone">
              <p>
                Delete <strong>{channel.name}</strong>? Its messages will be
                permanently removed. Anyone in this channel will be
                disconnected.
              </p>
              {error && <p role="alert">{error}</p>}
              <div className="managedChannelActions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDeleting("")}
                >
                  Cancel
                </button>
                <button
                  className="danger"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await onDelete(channel);
                      setDeleting("");
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "Channel could not be deleted.",
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Deleting…" : "Confirm delete channel"}
                </button>
              </div>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
