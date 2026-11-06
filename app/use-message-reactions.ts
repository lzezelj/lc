"use client";
import { useEffect, useRef, useState } from "react";
import type { MessageReaction } from "./emoji-catalog";

export function useMessageReactions(
  accountId: string | undefined,
  scope: { channelId?: string; userId?: string },
  messageIds: string[],
) {
  const key = accountId
    ? `${accountId}:${scope.channelId ?? ""}:${scope.userId ?? ""}`
    : "";
  const idsKey = [...new Set(messageIds)].join(",");
  const [snapshot, setSnapshot] = useState<{
    key: string;
    data: Record<string, MessageReaction[]>;
    error: string;
  }>({ key: "", data: {}, error: "" });
  const reload = useRef<(ids?: string[]) => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    const ids = idsKey ? idsKey.split(",") : [];
    const revisions = new Map<string, number>();
    const refresh = async (selected = ids) => {
      if (!key || (!scope.channelId && !scope.userId) || !selected.length)
        return;
      const versions = new Map(
        selected.map((id) => {
          const version = (revisions.get(id) ?? 0) + 1;
          revisions.set(id, version);
          return [id, version];
        }),
      );
      try {
        for (let start = 0; start < selected.length; start += 100) {
          const batch = selected.slice(start, start + 100);
          const query = new URLSearchParams({
            messageIds: batch.join(","),
            ...(scope.channelId
              ? { channelId: scope.channelId }
              : { userId: scope.userId! }),
          });
          const response = await fetch(`/api/message-reactions?${query}`);
          if (!response.ok)
            throw new Error(
              "Reactions could not be loaded. Refocus the window to retry.",
            );
          const result = (await response.json()) as Record<
            string,
            MessageReaction[]
          >;
          if (!active) return;
          setSnapshot((previous) => {
            const data =
              previous.key === key
                ? Object.fromEntries(
                    ids
                      .filter((id) => previous.data[id])
                      .map((id) => [id, previous.data[id]]),
                  )
                : {};
            for (const id of batch)
              if (revisions.get(id) === versions.get(id))
                data[id] = result[id] ?? [];
            return { key, data, error: "" };
          });
        }
      } catch (error) {
        if (
          active &&
          selected.some((id) => revisions.get(id) === versions.get(id))
        )
          setSnapshot((previous) => ({
            key,
            data: previous.key === key ? previous.data : {},
            error:
              error instanceof Error ? error.message : "Reactions unavailable",
          }));
      }
    };
    reload.current = refresh;
    void refresh();
    const onChange = (event: Event) => {
      const id = (event as CustomEvent<{ messageId?: string }>).detail
        ?.messageId;
      if (!id) void refresh();
      else if (ids.includes(id)) void refresh([id]);
    };
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("lc-message-reactions", onChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      active = false;
      window.removeEventListener("lc-message-reactions", onChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, [key, idsKey, scope.channelId, scope.userId]);
  return {
    data: snapshot.key === key ? snapshot.data : {},
    error: snapshot.key === key ? snapshot.error : "",
    refresh: (id: string) => reload.current([id]),
  };
}
