"use client";
import { LoadingSkeleton } from "./loading-skeleton";
import { messageSequences } from "./message-sequences";

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export function ChatHistory({
  threadId,
  messages,
  ready,
  hasMore,
  loadingOlder,
  onLoadOlder,
  ownUserId,
  children,
  focusMessageId,
  focusSequence,
  contextNotice,
  onJumpToPresent,
  firstUnreadId,
  onLatestVisibilityChange,
}: {
  threadId: string;
  messages: {
    id: string;
    authorId: string;
    kind?: string;
    deleted?: boolean;
    replyTo?: unknown;
    sentAt?: number;
  }[];
  ready: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => Promise<void>;
  ownUserId: string;
  children: ReactNode;
  focusMessageId?: string;
  focusSequence?: number;
  contextNotice?: ReactNode;
  onJumpToPresent?: () => void;
  firstUnreadId?: string | null;
  onLatestVisibilityChange?: (visible: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const jump = useRef<HTMLButtonElement>(null);
  const [showJump, setShowJump] = useState(false);
  const hasExternalJump = Boolean(onJumpToPresent);
  const latestId = messages.at(-1)?.id;
  const visibilityCallback = useRef(onLatestVisibilityChange);
  useEffect(() => {
    visibilityCallback.current = onLatestVisibilityChange;
  }, [onLatestVisibilityChange]);
  const tones = new Map<string, number>();
  const sequences = messageSequences(messages, firstUnreadId);
  let tone = 0;
  messages.forEach((message, index) => {
    if (index > 0 && message.authorId !== messages[index - 1].authorId)
      tone = 1 - tone;
    tones.set(message.id, tone);
  });
  useEffect(() => {
    const node = root.current;
    const latest = node?.querySelectorAll<HTMLElement>("[data-message-id]");
    const lastMessage = latest?.[latest.length - 1];
    if (!node || !ready || !lastMessage) {
      visibilityCallback.current?.(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowJump(!entry.isIntersecting);
        visibilityCallback.current?.(
          entry.isIntersecting &&
            !hasExternalJump &&
            node.scrollHeight - node.clientHeight - node.scrollTop <= 4,
        );
      },
      { root: node },
    );
    observer.observe(lastMessage);
    return () => {
      observer.disconnect();
      visibilityCallback.current?.(false);
    };
  }, [latestId, ready, threadId, hasExternalJump]);
  useLayoutEffect(() => {
    const host = wrapper.current;
    const button = jump.current;
    if (!host || !button) return;
    const chat = host.closest(".chat");
    const send =
      chat?.querySelector<HTMLElement>("[data-chat-jump-target]") ??
      chat?.querySelector<HTMLElement>("[data-chat-send]");
    if (!send) return;
    const position = () => {
      const bounds = host.getBoundingClientRect();
      const target = send.getBoundingClientRect();
      const center = Math.max(
        28,
        Math.min(
          bounds.width - 28,
          target.left + target.width / 2 - bounds.left,
        ),
      );
      button.style.setProperty("--jump-center", `${center}px`);
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(host);
    observer.observe(send);
    return () => observer.disconnect();
  }, [showJump, hasExternalJump, threadId, ready]);
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
    if (!previous.initialized || previous.thread !== threadId) {
      node.scrollTop = node.scrollHeight;
      setShowJump(false);
    } else if (
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
    ) {
      node.scrollTop = node.scrollHeight;
      setShowJump(false);
    }
    state.current = {
      ...previous,
      thread: threadId,
      initialized: true,
      first,
      last,
    };
    remember();
  }, [threadId, messages, ready, ownUserId]);
  useLayoutEffect(() => {
    const node = root.current;
    const target = Array.from(
      node?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [],
    ).find((element) => element.dataset.messageId === focusMessageId);
    if (node && target && ready) {
      node.scrollTop +=
        target.getBoundingClientRect().top -
        node.getBoundingClientRect().top -
        (node.clientHeight - target.offsetHeight) / 2;
      remember();
    }
    if (node)
      visibilityCallback.current?.(
        ready &&
          !hasExternalJump &&
          node.scrollHeight - node.clientHeight - node.scrollTop <= 4,
      );
  }, [focusMessageId, focusSequence, ready, threadId, hasExternalJump]);
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
      className={`chatHistory ${contextNotice ? "hasSearchContext" : ""}`}
      ref={wrapper}
    >
      {contextNotice}
      <div
        ref={root}
        tabIndex={-1}
        className="chatLog"
        aria-busy={!ready}
        onScroll={() => {
          remember();
          if (root.current)
            visibilityCallback.current?.(
              ready &&
                !hasExternalJump &&
                root.current.scrollHeight -
                  root.current.clientHeight -
                  root.current.scrollTop <=
                  4,
            );
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
        {!ready && <LoadingSkeleton kind="messages" />}
        {ready &&
          firstUnreadId &&
          !messages.some((message) => message.id === firstUnreadId) && (
            <p className="unreadOutsidePage" role="status">
              Unread messages outside this loaded history
            </p>
          )}
        {ready
          ? Children.map(children, (child) => {
              if (
                !isValidElement<{
                  "data-message-id"?: string;
                  "data-message-tone"?: number;
                  "data-message-continuation"?: boolean;
                  "data-message-continues"?: boolean;
                }>(child)
              )
                return child;
              const id = child.props["data-message-id"];
              const content =
                id && tones.has(id)
                  ? cloneElement(child, {
                      "data-message-tone": tones.get(id),
                      "data-message-continuation":
                        sequences.get(id)?.continuation || undefined,
                      "data-message-continues":
                        sequences.get(id)?.continues || undefined,
                    })
                  : child;
              return id === firstUnreadId ? (
                <Fragment key={id}>
                  <div
                    className="newMessagesDivider"
                    role="separator"
                    aria-label="New messages"
                  >
                    <span>New messages</span>
                  </div>
                  {content}
                </Fragment>
              ) : (
                content
              );
            })
          : null}
      </div>
      {ready && (hasExternalJump || (messages.length > 0 && showJump)) && (
        <button
          ref={jump}
          type="button"
          className="jumpToPresent"
          aria-label="Jump to present"
          title="Jump to present"
          onClick={() => {
            if (onJumpToPresent) {
              onJumpToPresent();
              return;
            }
            const node = root.current;
            if (!node) return;
            node.focus({ preventScroll: true });
            node.scrollTo({
              top: node.scrollHeight,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "auto"
                : "smooth",
            });
          }}
        >
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 4v16m-6-6 6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
