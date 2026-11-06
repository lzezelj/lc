"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EmojiPicker } from "./emoji-picker";
import type { MessageReaction } from "./emoji-catalog";
import { SettingsModal } from "./settings-modal";
import { SessionCache } from "./conversation-cache";
import { LoadingSkeleton } from "./loading-skeleton";

type ReactionProps = {
  accountId: string;
  messageId: string;
  reactions?: MessageReaction[];
  channelId?: string;
  userId?: string;
  onRefresh: (id: string) => Promise<void>;
};
function useReactionAction(
  { messageId, channelId, userId, onRefresh }: ReactionProps,
  onDone?: () => void,
) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function react(emoji: string, remove = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/message-reactions", {
        method: remove ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          emoji,
          ...(channelId ? { channelId } : { userId }),
        }),
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? "Could not update reaction");
      }
      await onRefresh(messageId);
      onDone?.();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update reaction",
      );
    } finally {
      setBusy(false);
    }
  }
  return { react, busy, error };
}

export function MessageReactionMenu(
  props: ReactionProps & { onDone: () => void },
) {
  const { react, busy, error } = useReactionAction(props, props.onDone);
  return (
    <>
      <EmojiPicker
        label="React"
        menuItem
        disabled={busy}
        onSelect={(emoji) => void react(emoji)}
      />
      {error && (
        <small className="reactionError" role="alert">
          {error}
        </small>
      )}
    </>
  );
}

type Reactor = {
  userId: string;
  name: string | null;
  emoji: string;
  me: boolean;
};
const detailsCache = new SessionCache<{ people: Reactor[]; at: number }>(
  512 * 1024,
  100,
);

function ReactionDetails(props: ReactionProps & { onClose: () => void }) {
  const cacheKey = `${props.channelId ? `channel:${props.channelId}` : `direct:${props.userId}`}:${props.messageId}`;
  const [people, setPeople] = useState<Reactor[] | undefined>(() => {
    detailsCache.scope(props.accountId);
    const cached = detailsCache.get(props.accountId, cacheKey);
    return cached && Date.now() - cached.at < 5 * 60_000
      ? cached.people
      : undefined;
  });
  const [loadError, setLoadError] = useState("");
  const { react, busy, error } = useReactionAction(props);
  const summary = JSON.stringify(props.reactions);
  useEffect(() => {
    let active = true;
    let revision = 0;
    async function load() {
      const current = ++revision;
      try {
        const query = new URLSearchParams({
          messageIds: props.messageId,
          details: "1",
          ...(props.channelId
            ? { channelId: props.channelId }
            : { userId: props.userId! }),
        });
        const response = await fetch(`/api/message-reactions?${query}`);
        const body = await response.json();
        if (!response.ok) {
          if (
            active &&
            current === revision &&
            [401, 403, 404].includes(response.status)
          ) {
            detailsCache.delete(props.accountId, cacheKey);
            setPeople([]);
          }
          throw new Error(body.error ?? "Could not load reactions");
        }
        if (active && current === revision) {
          setPeople(body.people);
          detailsCache.set(props.accountId, cacheKey, {
            people: body.people,
            at: Date.now(),
          });
          setLoadError("");
        }
      } catch (error) {
        if (active && current === revision)
          setLoadError(
            error instanceof Error ? error.message : "Could not load reactions",
          );
      } finally {
        if (active && current === revision)
          setPeople((previous) => previous ?? []);
      }
    }
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail?.messageId === props.messageId)
        void load();
    };
    void load();
    window.addEventListener("lc-message-reactions", changed);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    return () => {
      active = false;
      window.removeEventListener("lc-message-reactions", changed);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
    };
  }, [
    props.accountId,
    props.messageId,
    props.channelId,
    props.userId,
    cacheKey,
    summary,
  ]);
  return (
    <SettingsModal
      title="Reactions"
      closeLabel="Close reactions"
      className="messageReactionsModal"
      onClose={props.onClose}
    >
      {people === undefined ? (
        <LoadingSkeleton kind="reactions" />
      ) : !people.length && !loadError ? (
        <p>No reactions yet.</p>
      ) : null}
      <ul className="reactionPeople">
        {people?.map((person) => (
          <li key={person.userId}>
            <span className="reactionPersonEmoji">{person.emoji}</span>
            <span className="reactionPersonName">
              {person.name || "Unknown user"}
              {person.me && <small> (you)</small>}
            </span>
            {person.me && (
              <button
                type="button"
                className="reactionRemove danger"
                disabled={busy}
                aria-label="Remove your reaction"
                title="Remove your reaction"
                onClick={() => void react(person.emoji, true)}
              >
                <svg
                  aria-hidden="true"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </li>
        ))}
      </ul>
      {(error || loadError) && (
        <p className="reactionError" role="alert">
          {error || loadError}
        </p>
      )}
    </SettingsModal>
  );
}

export function MessageReactions(props: ReactionProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const reactions = props.reactions ?? [];
  useLayoutEffect(() => {
    const article = anchor.current?.closest<HTMLElement>("[data-message-id]");
    const log = article?.closest<HTMLElement>(".chatLog");
    if (!article || !log) return;
    let previousHeight = article.getBoundingClientRect().height;
    // Observe the final layout: closing the picker and wrapping reaction rows
    // can change message height in separate React commits.
    const observer = new ResizeObserver(() => {
      const message = article.getBoundingClientRect();
      const viewport = log.getBoundingClientRect();
      const top = viewport.top + log.clientTop;
      const bottom = top + log.clientHeight;
      if (
        message.height > previousHeight &&
        message.top < bottom &&
        message.bottom > top &&
        message.bottom > bottom
      ) {
        log.scrollTop += message.bottom - bottom + 8;
      }
      previousHeight = message.height;
    });
    observer.observe(article);
    return () => observer.disconnect();
  }, [props.messageId]);
  return (
    <>
      <span ref={anchor} hidden />
      {reactions.length > 0 && (
        <div className="messageReactions">
          {reactions.map((reaction) => (
            <button
              type="button"
              key={reaction.emoji}
              className={`reactionChip ${reaction.me ? "reacted" : ""}`}
              aria-pressed={reaction.me}
              aria-haspopup="dialog"
              aria-label={`${reaction.emoji}, ${reaction.count} ${reaction.count === 1 ? "reaction" : "reactions"}${reaction.me ? ", including yours" : ""}`}
              title="View reactions"
              onClick={() => setOpen(true)}
            >
              <span className="reactionEmoji">{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      )}
      {open && (
        <ReactionDetails
          key={`${props.accountId}:${props.channelId ?? props.userId}:${props.messageId}`}
          {...props}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
