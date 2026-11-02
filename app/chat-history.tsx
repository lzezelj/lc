"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function ChatHistory({
  threadId,
  messages,
  ready,
  hasMore,
  loadingOlder,
  onLoadOlder,
  ownUserId,
  children,
}: {
  threadId: string;
  messages: { id: string; authorId: string }[];
  ready: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<void>;
  ownUserId: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const state = useRef<{
    thread: string;
    initialized: boolean;
    first: string;
    last: string;
    nearBottom: boolean;
    anchor: string;
    offset: number;
  }>({
    thread: "",
    initialized: false,
    first: "",
    last: "",
    nearBottom: true,
    anchor: "",
    offset: 0,
  });
  function remember() {
    const node = root.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top;
    const anchor = [
      ...node.querySelectorAll<HTMLElement>("[data-message-id]"),
    ].find((element) => element.getBoundingClientRect().bottom > top);
    state.current.nearBottom =
      node.scrollHeight - node.clientHeight - node.scrollTop < 64;
    state.current.anchor = anchor?.dataset.messageId ?? "";
    state.current.offset = anchor
      ? anchor.getBoundingClientRect().top - top
      : 0;
  }
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !ready) return;
    const previous = state.current;
    const first = messages[0]?.id ?? "",
      last = messages.at(-1)?.id ?? "";
    if (!previous.initialized || previous.thread !== threadId)
      node.scrollTop = node.scrollHeight;
    else if (
      first !== previous.first &&
      messages.some((message) => message.id === previous.first)
    ) {
      const anchor = [
        ...node.querySelectorAll<HTMLElement>("[data-message-id]"),
      ].find((element) => element.dataset.messageId === previous.anchor);
      if (anchor)
        node.scrollTop +=
          anchor.getBoundingClientRect().top -
          node.getBoundingClientRect().top -
          previous.offset;
    } else if (
      last !== previous.last &&
      (previous.nearBottom || messages.at(-1)?.authorId === ownUserId)
    )
      node.scrollTop = node.scrollHeight;
    state.current = {
      ...previous,
      thread: threadId,
      initialized: true,
      first,
      last,
    };
    remember();
  }, [threadId, messages, ready, ownUserId]);
  async function loadOlder() {
    if (!ready || !hasMore || loadingOlder || pending.current) return;
    pending.current = true;
    try {
      await onLoadOlder();
    } finally {
      pending.current = false;
    }
  }
  return (
    <div
      ref={root}
      className="chatLog"
      aria-busy={!ready}
      onScroll={() => {
        remember();
        if (root.current && root.current.scrollTop < 80) void loadOlder();
      }}
    >
      {hasMore && (
        <button
          className="loadOlderMessages"
          type="button"
          disabled={!ready || loadingOlder}
          onClick={() => void loadOlder()}
        >
          {loadingOlder ? "Loading…" : "Load 50 older messages"}
        </button>
      )}
      {!ready && <p className="empty">Loading messages…</p>}
      {ready ? children : null}
    </div>
  );
}
