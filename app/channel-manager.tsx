"use client";

import { useState } from "react";
import { SettingsNameForm } from "./settings-modal";
import { useDragReorder, ReorderHandle, ReorderStatus } from "./drag-reorder";
import type { DropPlacement } from "../lib/list-order";

type ManagedChannel = {
  id: string;
  name: string;
  type: "text" | "voice_direct" | "voice_group";
};
export function ChannelManager({
  channels,
  onRename,
  onDelete,
  onReorder,
}: {
  channels: ManagedChannel[];
  onRename: (channel: ManagedChannel, name: string) => Promise<void>;
  onDelete: (channel: ManagedChannel) => Promise<void>;
  onReorder?: (
    channel: ManagedChannel,
    targetId: string,
    placement: DropPlacement,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState("");
  const [deleting, setDeleting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const drag = useDragReorder({
    items: channels.map((channel) => ({
      ...channel,
      group: channel.type === "text" ? "text" : "voice",
    })),
    scope: "channel-manager",
    enabled: !!onReorder && !busy,
    onReorder: async (id, targetId, placement) => {
      const channel = channels.find((row) => row.id === id);
      if (channel) await onReorder?.(channel, targetId, placement);
    },
  });
  const visible = [
    ...channels.filter((channel) => channel.type === "text"),
    ...channels.filter((channel) => channel.type !== "text"),
  ].filter((channel) =>
    `${channel.name} ${channel.type}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="channelManager">
      <ReorderStatus drag={drag} />
      <label>
        Search channels
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {channels.length === 0 && (
        <p className="empty">No channels yet. Create one above.</p>
      )}
      {!!channels.length && !visible.length && (
        <p className="empty">No channels match this search.</p>
      )}
      {visible.map((channel) => (
        <section
          className="managedChannel"
          key={channel.id}
          {...drag.itemProps(channel.id)}
        >
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
              {onReorder && <ReorderHandle drag={drag} id={channel.id} />}
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
