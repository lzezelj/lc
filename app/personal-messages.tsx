"use client";
import { useEffect, useState } from "react";
import { SettingsModal } from "./settings-modal";
import { MessageDeleteAction } from "./message-delete-action";

type PersonalMessage = {
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
}: {
  currentServerId: string;
}) {
  const [messages, setMessages] = useState<PersonalMessage[]>([]),
    [query, setQuery] = useState("");
  const [group, setGroup] = useState<{
      id: string;
      kind: "server" | "direct";
      name: string;
    } | null>(null),
    [messageQuery, setMessageQuery] = useState("");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/users/me/message-history", { signal: abort.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Messages could not be loaded.");
        if (!abort.signal.aborted) setMessages(data);
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, []);
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
    setMessages((current) =>
      current.filter((message) => !data.deletedIds.includes(message.id)),
    );
  }
  return (
    <section className="personalMessages">
      <h3>My messages</h3>
      <label>
        Search servers and direct messages
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {loading && <p className="empty">Loading messages…</p>}
      <div className="messageDestinationList">
        {groups
          .filter((item) =>
            item.name.toLowerCase().includes(query.trim().toLowerCase()),
          )
          .map((item) => (
            <button
              type="button"
              key={`${item.kind}:${item.id}`}
              onClick={() => {
                setGroup(item);
                setMessageQuery("");
              }}
            >
              <strong>{item.name}</strong>
              <small>
                {item.kind === "server" ? "Server" : "Direct message"}
              </small>
            </button>
          ))}
      </div>
      {!loading && !groups.length && (
        <p className="empty">No messages found.</p>
      )}
      {group && (
        <SettingsModal title={group.name} onClose={() => setGroup(null)}>
          <div className="personalMessageWindow">
            <label>
              Search messages
              <input
                type="search"
                value={messageQuery}
                onChange={(event) => setMessageQuery(event.target.value)}
              />
            </label>
            <MessageDeleteAction
              label="Delete all my messages here"
              confirmation="Permanently delete all your messages in this conversation or server? This cannot be undone."
              onDelete={() => remove()}
            />
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
                  <p>{message.deletedAt ? "Deleted message" : message.text}</p>
                  <MessageDeleteAction
                    label="Delete permanently"
                    confirmation="Permanently delete this message?"
                    onDelete={() => remove(message.id)}
                  />
                </article>
              ))}
          </div>
        </SettingsModal>
      )}
    </section>
  );
}
