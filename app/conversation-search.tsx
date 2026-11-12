"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { MessageAttachment } from "./attachment-types";
import { useDebouncedSearch } from "./use-search-debounce";

export type SearchMessage = {
  id: string;
  authorId: string;
  author: string;
  authorImage?: string | null;
  text: string;
  createdAt: string;
  editedAt?: string | null;
  editedByAdmin?: boolean;
  deleted?: boolean;
  deletedAt?: string | null;
  attachments?: MessageAttachment[];
  mentions?: import("./notification-types").Mention[];
  replyTo?: { id: string; text: string; author: string } | null;
  kind?: "message" | "call";
  callDurationSeconds?: number | null;
};
type Cursor = { beforeId: string; beforeCreatedAt: string };
type SearchProps = {
  channelId?: string;
  userId?: string;
  onResult: (messages: SearchMessage[], targetId: string) => void;
};

export function ConversationSearch(props: SearchProps) {
  return (
    <ConversationSearchInput key={props.channelId ?? props.userId} {...props} />
  );
}

function ConversationSearchInput({ channelId, userId, onResult }: SearchProps) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchMessage[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const { schedule, cancel } = useDebouncedSearch((text: string) => {
    void load(text);
  });
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!open && query.trim().length < 2) return;
    const close = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) {
        cancel();
        request.current?.abort();
        setBusy(false);
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, query, cancel]);
  async function load(text: string, more?: Cursor, contextId?: string) {
    cancel();
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setOpen(true);
    if (!more && !contextId) {
      setResults([]);
      setCursor(null);
      setSubmitted(text);
    }
    try {
      const params = new URLSearchParams(
        channelId ? { channelId } : { userId: userId! },
      );
      if (contextId) params.set("contextId", contextId);
      else {
        params.set("q", text);
        if (more) {
          params.set("beforeId", more.beforeId);
          params.set("beforeCreatedAt", more.beforeCreatedAt);
        }
      }
      const response = await fetch(`/api/message-search?${params}`, {
        signal: controller.signal,
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok)
        throw new Error(data.error ?? "Search could not be completed.");
      if (contextId) {
        onResult(data.messages, contextId);
        setOpen(false);
      } else {
        setResults((current) =>
          more ? [...current, ...data.messages] : data.messages,
        );
        setCursor(data.nextCursor);
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Search could not be completed.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length >= 2) void load(query.trim());
  }
  return (
    <div
      className="conversationSearch"
      ref={host}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel();
          request.current?.abort();
          setOpen(false);
          setBusy(false);
          event.stopPropagation();
        }
      }}
    >
      <form
        onSubmit={submit}
        role="search"
        aria-label="Search this conversation"
      >
        <input
          type="search"
          aria-label="Search messages"
          placeholder="Search messages"
          value={query}
          maxLength={100}
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            request.current?.abort();
            cancel();
            setBusy(false);
            setOpen(false);
            if (value.trim().length >= 2) schedule(value.trim());
          }}
        />
        <button
          type="submit"
          aria-label="Search this conversation"
          disabled={query.trim().length < 2}
          title="Search messages and attachment names"
        >
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="m16 16 5 5" />
          </svg>
        </button>
      </form>
      {open && (
        <section
          className="messageSearchResults"
          aria-label="Message search results"
        >
          <div className="searchResultsHeading">
            <strong>Results for “{submitted}”</strong>
            <button
              type="button"
              aria-label="Close search results"
              onClick={() => {
                cancel();
                request.current?.abort();
                setBusy(false);
                setOpen(false);
              }}
            >
              ×
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
          {!busy && !error && !results.length && <p>No matching messages.</p>}
          {results.map((message) => (
            <button
              className="messageSearchResult"
              type="button"
              key={message.id}
              disabled={busy}
              onClick={() => void load(submitted, undefined, message.id)}
              title="View surrounding messages"
            >
              <span>
                <strong>{message.author}</strong>
                <time>{new Date(message.createdAt).toLocaleString()}</time>
              </span>
              <p>
                {message.text ||
                  message.attachments?.map((file) => file.name).join(", ") ||
                  "Attachment"}
              </p>
            </button>
          ))}
          {busy && <p role="status">Searching…</p>}
          {cursor && (
            <button
              type="button"
              className="loadSearchResults"
              disabled={busy}
              onClick={() => void load(submitted, cursor)}
            >
              Load more results
            </button>
          )}
        </section>
      )}
    </div>
  );
}
