"use client";
import { useEffect, useRef, useState } from "react";
import type {
  NotificationKind,
  NotificationPreference,
  NotificationScope,
} from "./notification-types";
type SavePreference = (
  scope: NotificationScope,
  id: string,
  kind: NotificationKind,
  mode: string,
) => Promise<void>;
export type NotificationTarget = {
  scope: NotificationScope;
  id: string;
  name: string;
  x: number;
  y: number;
};

function NotificationPreferenceControls({
  scope,
  item,
  preferences,
  onSave,
}: {
  scope: NotificationScope;
  item: { id: string; name: string };
  preferences: NotificationPreference[];
  onSave: SavePreference;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    void Promise.resolve().then(() => setNow(Date.now()));
  }, [preferences]);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  function control(kind: NotificationKind) {
    const preference = preferences.find(
        (pref) => pref.scope === scope && pref.targetId === item.id,
      ),
      until =
        kind === "messages"
          ? preference?.messageMuteUntil
          : kind === "calls"
            ? preference?.callMuteUntil
            : preference?.mentionMuteUntil;
    const muted = !!until && Date.parse(until) > now,
      value = preference?.[kind] === false ? "off" : muted ? "muted" : "on",
      key = `${scope}:${item.id}:${kind}`;
    return (
      <label key={kind}>
        <span>
          {kind === "messages"
            ? "Messages"
            : kind === "calls"
              ? "Calls"
              : "Mentions"}
        </span>
        <select
          aria-label={`${kind} notifications for ${item.name}`}
          value={value}
          disabled={!!busy}
          onChange={async (event) => {
            setBusy(key);
            setError("");
            try {
              await onSave(scope, item.id, kind, event.target.value);
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Could not save settings.",
              );
            } finally {
              setBusy("");
            }
          }}
        >
          <option value="on">Enabled</option>
          {muted && (
            <option value="muted" disabled>
              Muted until {new Date(until!).toLocaleString()}
            </option>
          )}
          <option value="60">Mute for 1 hour</option>
          <option value="480">Mute for 8 hours</option>
          <option value="1440">Mute for 24 hours</option>
          <option value="off">Disabled until enabled</option>
        </select>
      </label>
    );
  }
  return (
    <section className="notificationPreference">
      <strong>{item.name}</strong>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Saving notification settings…</p>}
      {control("messages")}
      {control(scope === "server" ? "mentions" : "calls")}
    </section>
  );
}

export function NotificationMuteMenu({
  target,
  preferences,
  onSave,
  onClose,
}: {
  target: NotificationTarget;
  preferences: NotificationPreference[];
  onSave: SavePreference;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  return (
    <div
      ref={panel}
      className="notificationMuteMenu"
      role="dialog"
      aria-label={`Mute notifications for ${target.name}`}
      style={{ left: target.x, top: target.y }}
    >
      <header>
        <strong>Mute notifications</strong>
        <button type="button" aria-label="Close mute options" onClick={onClose}>
          ×
        </button>
      </header>
      <NotificationPreferenceControls
        scope={target.scope}
        item={target}
        preferences={preferences}
        onSave={onSave}
      />
    </div>
  );
}

export function NotificationSettings({
  servers,
  friends,
  preferences,
  onSave,
}: {
  servers: { id: string; name: string }[];
  friends: { id: string; name: string }[];
  preferences: NotificationPreference[];
  onSave: SavePreference;
}) {
  const [category, setCategory] = useState<"server" | "direct">("server");
  const [queries, setQueries] = useState({ server: "", direct: "" });
  const items = category === "server" ? servers : friends;
  const matches = items.filter((item) =>
    item.name
      .toLocaleLowerCase()
      .includes(queries[category].trim().toLocaleLowerCase()),
  );
  return (
    <section className="notificationSettings">
      <h3>Notifications</h3>
      <p className="settingsDescription">
        Choose alerts for each server and direct conversation. Reading still
        marks messages as seen when notifications are disabled. Do not disturb
        silences all alerts.
      </p>
      <div
        className="friendTabs"
        role="group"
        aria-label="Notification categories"
      >
        <button
          type="button"
          aria-pressed={category === "server"}
          className={category === "server" ? "active" : ""}
          onClick={() => setCategory("server")}
        >
          Servers
        </button>
        <button
          type="button"
          aria-pressed={category === "direct"}
          className={category === "direct" ? "active" : ""}
          onClick={() => setCategory("direct")}
        >
          People
        </button>
      </div>
      <input
        type="search"
        aria-label={
          category === "server"
            ? "Search notification servers"
            : "Search notification people"
        }
        placeholder={category === "server" ? "Search servers" : "Search people"}
        value={queries[category]}
        onChange={(event) =>
          setQueries({ ...queries, [category]: event.target.value })
        }
      />
      <h4>{category === "server" ? "Servers" : "People"}</h4>
      {!matches.length && (
        <p className="settingsDescription">
          {items.length
            ? "No matches found."
            : category === "server"
              ? "No servers yet."
              : "Accepted friends appear here."}
        </p>
      )}
      {matches.map((item) => (
        <NotificationPreferenceControls
          key={`${category}:${item.id}`}
          scope={category}
          item={item}
          preferences={preferences}
          onSave={onSave}
        />
      ))}
    </section>
  );
}
