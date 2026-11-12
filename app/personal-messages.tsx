"use client";
import { SettingsSection } from "./settings-section";
import { useEffect, useRef, useState } from "react";
import type { SessionCache } from "./conversation-cache";
import { SettingsModal } from "./settings-modal";
import { MessageDeleteAction } from "./message-delete-action";
import { SettingsDestinations } from "./settings-destinations";

export type PersonalMessage = {
  id: string;
  text: string;
  createdAt: string;
  deletedAt: string | null;
  kind: "server" | "direct";
  groupId: string;
  groupName: string;
  channelName?: string;
};
export function PersonalMessages({
  currentServerId,
  accountId,
  cache,
}: {
  currentServerId: string;
  accountId: string;
  cache: SessionCache<PersonalMessage[]>;
}) {
  const cached = cache.get(accountId, "personal-messages");
  const revision = useRef(0);
  const [messages, setMessages] = useState<PersonalMessage[]>(
      () => cached ?? [],
    ),
    [category, setCategory] = useState<"server" | "direct">("server"),
    [queries, setQueries] = useState({ server: "", direct: "" });
  const [group, setGroup] = useState<{
      id: string;
      kind: "server" | "direct";
      name: string;
    } | null>(null),
    [messageQuery, setMessageQuery] = useState("");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(!cached);
  useEffect(() => {
    const abort = new AbortController();
    const startedAtRevision = revision.current;
    void fetch("/api/users/me/message-history", { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          if (
            !abort.signal.aborted &&
            (response.status === 401 || response.status === 403)
          ) {
            cache.delete(accountId, "personal-messages");
            setMessages([]);
          }
          throw new Error(data.error ?? "Messages could not be loaded.");
        }
        if (!abort.signal.aborted && startedAtRevision === revision.current) {
          setMessages(data);
          cache.set(accountId, "personal-messages", data);
        }
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [accountId, cache]);
  const groups = [
    ...new Map(
      messages.map((message) => [
        `${message.kind}:${message.groupId}`,
        { id: message.groupId, name: message.groupName, kind: message.kind },
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      Number(b.id === currentServerId) - Number(a.id === currentServerId) ||
      b.kind.localeCompare(a.kind) ||
      a.name.localeCompare(b.name),
  );
  const visibleGroups = groups.filter(
    (item) =>
      item.kind === category &&
      item.name.toLowerCase().includes(queries[category].trim().toLowerCase()),
  );
  async function remove(messageId?: string) {
    if (!group) return;
    const response = await fetch("/api/users/me/message-history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: group.kind,
        groupId: group.id,
        ...(messageId ? { messageId } : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? "Messages could not be deleted.");
    revision.current++;
    const remaining = messages.filter(
      (message) => !data.deletedIds.includes(message.id),
    );
    setMessages(remaining);
    cache.set(accountId, "personal-messages", remaining);
  }
  return (
    <SettingsSection
      title="My messages"
      className="personalMessages"
      hint="Find your sent messages in a server or to a person."
    >
      <SettingsDestinations
        label="My messages"
        category={category}
        onCategory={setCategory}
        query={queries[category]}
        onQuery={(query) => setQueries({ ...queries, [category]: query })}
      />
      {error && <p role="alert">{error}</p>}
      {loading && <p className="empty">Loading messages…</p>}
      <div className="messageDestinationList">
        {visibleGroups.map((item) => (
          <button
            type="button"
            key={`${item.kind}:${item.id}`}
            onClick={() => {
              setGroup(item);
              setMessageQuery("");
            }}
          >
            <strong>{item.name}</strong>
          </button>
        ))}
      </div>
      {!loading && !visibleGroups.length && !error && (
        <p className="settingsDescription">
          {queries[category].trim()
            ? "No matches found."
            : category === "server"
              ? "No server messages found."
              : "No direct messages found."}
        </p>
      )}
      {group && (
        <SettingsModal
          title={group.name}
          className="settingsWorkspace personalMessagesModal"
          onClose={() => setGroup(null)}
        >
          <div className="personalMessageWindow">
            <label>
              Search messages
              <input
                type="search"
                placeholder="Search messages"
                value={messageQuery}
                onChange={(event) => setMessageQuery(event.target.value)}
              />
            </label>
            <MessageDeleteAction
              label="Delete all my messages here"
              confirmation="Permanently delete all your messages in this conversation or server? This cannot be undone."
              onDelete={() => remove()}
            />
            <div className="personalMessageGrid">
              {messages
                .filter(
                  (message) =>
                    message.groupId === group.id &&
                    message.kind === group.kind &&
                    `${message.text} ${message.channelName ?? ""}`
                      .toLowerCase()
                      .includes(messageQuery.trim().toLowerCase()),
                )
                .map((message) => (
                  <article key={message.id}>
                    <small>
                      {message.channelName ? `#${message.channelName} · ` : ""}
                      {new Date(message.createdAt).toLocaleString()}
                    </small>
                    <p>
                      {message.deletedAt
                        ? "Deleted message"
                        : message.text || "Attachment"}
                    </p>
                    <MessageDeleteAction
                      label="Delete permanently"
                      confirmation="Permanently delete this message?"
                      onDelete={() => remove(message.id)}
                    />
                  </article>
                ))}
            </div>
          </div>
        </SettingsModal>
      )}
    </SettingsSection>
  );
}
