"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  WorkspaceActivity,
  type ActivityChannel,
  type ActivityMessage,
} from "./workspace-activity";

export function useWorkspaceActivity(
  userId: string | undefined,
  serverKey: string,
  visibleChannelId: string,
) {
  const current = useRef<{
    userId: string;
    tracker: WorkspaceActivity;
    active: boolean;
    request: number;
  } | null>(null);
  const visible = useRef(visibleChannelId);
  const [view, setView] = useState<{
    userId: string;
    channels: ActivityChannel[];
    unread: Record<string, boolean>;
  }>({ userId: "", channels: [], unread: {} });
  const publish = useCallback(() => {
    const state = current.current;
    if (!state?.active) return;
    try {
      state.tracker.mergeReads(
        JSON.parse(
          localStorage.getItem(`lc.channelReads.${state.userId}`) ?? "{}",
        ),
      );
    } catch {}
    if (document.visibilityState === "visible" && visible.current)
      state.tracker.read(visible.current);
    setView({
      userId: state.userId,
      channels: [...state.tracker.channels.values()],
      unread: state.tracker.unread(),
    });
    try {
      localStorage.setItem(
        `lc.channelReads.${state.userId}`,
        JSON.stringify(state.tracker.reads),
      );
    } catch {}
  }, []);
  const refresh = useCallback(async () => {
    const state = current.current;
    if (!state?.active) return;
    const version = state.tracker.version,
      request = ++state.request;
    try {
      const response = await fetch("/api/workspace-activity");
      if (!response.ok) return;
      const rows = (await response.json()) as ActivityChannel[];
      if (
        !state.active ||
        state !== current.current ||
        request !== state.request ||
        !Array.isArray(rows)
      )
        return;
      state.tracker.snapshot(rows, version);
      publish();
    } catch {
      /* Reconnect/focus retries the authoritative snapshot. */
    }
  }, [publish]);
  useEffect(() => {
    if (!userId) return;
    let reads: Record<string, string> = {};
    try {
      const saved = JSON.parse(
        localStorage.getItem(`lc.channelReads.${userId}`) ?? "{}",
      );
      if (saved && typeof saved === "object" && !Array.isArray(saved))
        reads = Object.fromEntries(
          Object.entries(saved).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
    } catch {}
    const state = {
      userId,
      tracker: new WorkspaceActivity(reads),
      active: true,
      request: 0,
    };
    current.current = state;
    void refresh();
    const focus = () => {
      publish();
      void refresh();
    };
    document.addEventListener("visibilitychange", focus);
    window.addEventListener("focus", focus);
    const storage = (event: StorageEvent) => {
      if (event.key === `lc.channelReads.${userId}`) publish();
    };
    window.addEventListener("storage", storage);
    return () => {
      state.active = false;
      document.removeEventListener("visibilitychange", focus);
      window.removeEventListener("focus", focus);
      window.removeEventListener("storage", storage);
    };
  }, [userId, serverKey, refresh, publish]);
  useEffect(() => {
    visible.current = visibleChannelId;
    void Promise.resolve().then(publish);
  }, [visibleChannelId, publish]);
  const handle = useCallback(
    (event: {
      type: string;
      channelId?: string;
      messageId?: string;
      createdAt?: string;
      authorId?: string;
    }) => {
      const state = current.current;
      if (!state?.active) return;
      if (
        event.type === "channel-activity" &&
        event.channelId &&
        event.messageId &&
        event.createdAt &&
        event.authorId
      ) {
        state.tracker.message(event as ActivityMessage, state.userId);
        publish();
      } else if (
        [
          "channel-activity-changed",
          "channel-deleted",
          "server-updated",
          "access-changed",
        ].includes(event.type)
      )
        void refresh();
    },
    [publish, refresh],
  );
  return {
    channels: view.userId === userId ? view.channels : [],
    unread: view.userId === userId ? view.unread : {},
    handle,
    refresh,
  };
}
