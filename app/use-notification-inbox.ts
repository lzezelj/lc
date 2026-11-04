"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  notificationAllowed,
  type NotificationInbox,
  type NotificationScope,
  type NotificationKind,
} from "./notification-types";
const empty: NotificationInbox = { channels: [], direct: [], preferences: [] };
export function useNotificationInbox(
  userId: string | undefined,
  accessKey: string,
  visible: {
    scope: "channel" | "direct";
    targetId: string;
    messageId: string;
    canRead?: () => boolean;
  } | null,
) {
  const [view, setView] = useState<{
    userId: string;
    data: NotificationInbox;
    ready: boolean;
  }>({ userId: "", data: empty, ready: false });
  const [foreground, setForeground] = useState(true);
  const request = useRef<AbortController | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    readKey = useRef("");
  const activeUser = useRef(userId);
  const active = useRef(false);
  useEffect(() => {
    activeUser.current = userId;
  }, [userId]);
  const refreshNow = useCallback(async () => {
    if (!active.current || !userId || activeUser.current !== userId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/notifications", {
        signal: controller.signal,
      });
      if (!response.ok) return;
      const data = await response.json();
      if (!controller.signal.aborted && activeUser.current === userId)
        setView({ userId, data, ready: true });
    } catch {}
  }, [userId]);
  const refresh = useCallback(() => {
    if (!active.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void refreshNow();
    }, 80);
  }, [refreshNow]);
  useEffect(() => {
    active.current = true;
    const focus = () => {
      setForeground(document.visibilityState === "visible");
      if (document.visibilityState === "visible") void refreshNow();
    };
    focus();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active.current = false;
      request.current?.abort();
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      readKey.current = "";
    };
  }, [refreshNow, accessKey]);
  const ready = view.userId === userId && view.ready,
    data = view.userId === userId ? view.data : empty;
  const scope = visible?.scope,
    targetId = visible?.targetId,
    messageId = visible?.messageId,
    canRead = visible?.canRead;
  useEffect(() => {
    if (
      !ready ||
      !foreground ||
      !scope ||
      !targetId ||
      !messageId ||
      canRead?.() === false
    ) {
      readKey.current = "";
      return;
    }
    const channel =
      scope === "channel"
        ? data.channels.find((item) => item.id === targetId)
        : null;
    const direct =
      scope === "direct"
        ? data.direct.find((item) => item.id === targetId)
        : null;
    if (!channel?.unread && !channel?.mentions && !direct?.unread) {
      readKey.current = "";
      return;
    }
    const key = `${userId}:${scope}:${targetId}:${messageId}:${channel?.mentions ?? 0}`;
    if (readKey.current === key) return;
    readKey.current = key;
    void fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, targetId, messageId }),
    })
      .then((response) => {
        if (!active.current || activeUser.current !== userId) return;
        if (!response.ok) {
          readKey.current = "";
          return;
        }
        void refreshNow();
      })
      .catch(() => {
        if (activeUser.current === userId) readKey.current = "";
      });
  }, [
    userId,
    ready,
    foreground,
    scope,
    targetId,
    messageId,
    data,
    refreshNow,
    canRead,
  ]);
  useEffect(() => {
    const expiries = data.preferences
      .flatMap((pref) => [
        pref.messageMuteUntil,
        pref.callMuteUntil,
        pref.mentionMuteUntil,
      ])
      .filter((value): value is string => !!value)
      .map(Date.parse)
      .filter((at) => at > Date.now());
    if (!expiries.length) return;
    const timeout = setTimeout(
      () => void refreshNow(),
      Math.min(...expiries) - Date.now() + 25,
    );
    return () => clearTimeout(timeout);
  }, [data, refreshNow]);
  async function save(
    scope: NotificationScope,
    targetId: string,
    kind: NotificationKind,
    mode: string,
  ) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, targetId, kind, mode }),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "Could not save notification settings.");
    await refreshNow();
  }
  return {
    ...data,
    ready,
    refresh,
    save,
    allowed: (scope: NotificationScope, id: string, kind: NotificationKind) =>
      notificationAllowed(data.preferences, scope, id, kind),
  };
}
