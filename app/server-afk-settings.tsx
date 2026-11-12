"use client";
import { InformationHint } from "./information-hint";
import { useState } from "react";

export function ServerAfkSettings({
  serverId,
  channelId,
  channels,
  onSaved,
}: {
  serverId: string;
  channelId?: string | null;
  channels: { id: string; name: string; type: string }[];
  onSaved: (channelId: string | null) => void;
}) {
  const [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  async function save(value: string) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/servers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId,
          ...(value === "create"
            ? { createAfk: true }
            : { afkChannelId: value || null }),
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "Could not save AFK settings.");
      onSaved(result.afkChannelId);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save AFK settings.",
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="mediaSettings settingsSubpanel">
      <h4 className="settingsFieldLabel">
        AFK channel{" "}
        <InformationHint text="After 15 minutes without activity, users in voice are moved to the selected group voice channel. Disable this or choose Create an AFK channel to add one." />
      </h4>
      <label>
        Move inactive users (after 15 minutes) to
        <select
          aria-label="AFK channel"
          disabled={saving}
          value={channelId ?? ""}
          onChange={(event) => void save(event.target.value)}
        >
          <option value="">Disabled</option>
          {channels
            .filter((channel) => channel.type === "voice_group")
            .map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          <option value="create">Create an AFK channel…</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
