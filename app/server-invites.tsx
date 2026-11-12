"use client";

import { useEffect, useRef, useState } from "react";
import { formatUserHandle } from "../user-handle";
import { SEARCH_DEBOUNCE_MS } from "./use-search-debounce";

export type InvitePerson = {
  id: string;
  name: string;
  handle?: string | null;
  image?: string | null;
  status?: string;
};
export function ServerInvites({
  serverId,
  mode,
  friends,
  memberIds,
  pendingIds = [],
  onSent,
}: {
  serverId: string;
  mode: "friends" | "people";
  friends: InvitePerson[];
  memberIds: string[];
  pendingIds?: string[];
  onSent: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InvitePerson[]>([]);
  const [selected, setSelected] = useState<InvitePerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (mode !== "people" || query.trim().length < 3) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/servers/${serverId}/invitees?q=${encodeURIComponent(query.trim())}`,
          { signal: controller.signal },
        );
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "People could not be searched.");
        if (!controller.signal.aborted) setResults(data);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error
              ? failure.message
              : "People could not be searched.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [serverId, mode, query]);
  const people = (
    mode === "friends"
      ? friends.filter((person) => person.status === "accepted")
      : query.trim().length >= 3
        ? results
        : []
  )
    .filter(
      (person) =>
        (mode === "friends" || !memberIds.includes(person.id)) &&
        (mode === "people" ||
          `${person.name} ${person.handle} ${formatUserHandle(person.handle)}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
    )
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
        (a.handle ?? "").localeCompare(b.handle ?? ""),
    );
  return (
    <section className="serverInvites">
      <h3>
        {mode === "friends"
          ? "Invite friends to server"
          : "Invite people to server"}
      </h3>
      <p className="settingsDescription">
        {mode === "friends"
          ? "Your friends are listed alphabetically. Existing members are marked below."
          : "Search existing LC accounts by name or username. Enter at least three characters. Demo access is managed in demo account settings."}
      </p>
      <label>
        {mode === "friends" ? "Search friends" : "Search people"}
        <input
          type="search"
          value={query}
          maxLength={100}
          onChange={(event) => {
            setQuery(event.target.value);
            setResults([]);
            setLoading(false);
          }}
        />
      </label>
      <div className="friendPickerList" aria-busy={loading}>
        {people.map((person) => (
          <label
            className="friendPickerRow"
            key={person.id}
            data-selected={selected.some((item) => item.id === person.id)}
            data-existing={memberIds.includes(person.id)}
          >
            <input
              type="checkbox"
              checked={selected.some((item) => item.id === person.id)}
              disabled={
                busy ||
                memberIds.includes(person.id) ||
                pendingIds.includes(person.id)
              }
              onChange={(event) =>
                setSelected((current) =>
                  event.target.checked
                    ? [...current, person]
                    : current.filter((item) => item.id !== person.id),
                )
              }
            />
            <span className="inviteAvatar" aria-hidden="true">
              {person.name[0]?.toUpperCase() ?? "?"}
            </span>
            <span className="invitePersonIdentity">
              <b>{person.name}</b>
              <small>{formatUserHandle(person.handle)}</small>
              {memberIds.includes(person.id) && (
                <small className="inviteMembership">Already in server</small>
              )}
              {!memberIds.includes(person.id) &&
                pendingIds.includes(person.id) && (
                  <small className="inviteMembership">Invitation pending</small>
                )}
            </span>
          </label>
        ))}
        {!people.length && (
          <p className="emptyState">
            {loading
              ? "Searching…"
              : mode === "people" && query.trim().length < 3
                ? "Search to find people to invite."
                : "No available people match this search."}
          </p>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className="inviteActions">
        <span>{selected.length} selected</span>
        <button
          type="button"
          className="primary"
          disabled={busy || !selected.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            setNotice("");
            try {
              const response = await fetch(`/api/servers/${serverId}/members`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  userIds: selected.map((person) => person.id),
                  mode,
                }),
              });
              const data = await response.json();
              if (!active.current) return;
              if (!response.ok)
                throw new Error(data.error ?? "People could not be invited.");
              onSent();
              setSelected([]);
              setNotice(
                `${data.invited.length} ${data.invited.length === 1 ? "invitation" : "invitations"} sent. Recipients can accept in Pending invites.`,
              );
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "People could not be invited.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Inviting…" : `Invite selected (${selected.length})`}
        </button>
      </div>
    </section>
  );
}
