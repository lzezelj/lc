"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export type ServerInvitation = {
  id: string;
  serverId: string;
  serverName: string;
  inviterId: string;
  inviterName: string;
  recipientId: string;
  recipientName: string;
  image?: string | null;
  incoming: boolean;
};
type Change = { invitationId?: string; serverId?: string; userId?: string };
export function useServerInvitations(
  userId: string | undefined,
  onJoined: (serverId: string, userId: string) => void,
) {
  const [view, setView] = useState<{
    userId?: string;
    rows: ServerInvitation[];
    ready: boolean;
    error: string;
  }>({ rows: [], ready: false, error: "" });
  const active = useRef(false),
    epoch = useRef(0),
    request = useRef<AbortController | null>(null),
    joined = useRef(new Set<string>()),
    callback = useRef(onJoined);
  useEffect(() => {
    callback.current = onJoined;
  });
  const refresh = useCallback(async () => {
    if (!active.current || !userId) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch("/api/server-invitations", {
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error("Server invitations could not be loaded.");
      const rows = await response.json();
      if (!controller.signal.aborted && active.current)
        setView({ userId, rows, ready: true, error: "" });
    } catch (error) {
      if (!controller.signal.aborted && active.current)
        setView((current) => ({
          userId,
          rows: current.userId === userId ? current.rows : [],
          ready: true,
          error:
            error instanceof Error
              ? error.message
              : "Server invitations could not be loaded.",
        }));
    }
  }, [userId]);
  const receive = useCallback(
    (data: Change | null = {}) => {
      void refresh();
      if (!data) return;
      if (
        data.invitationId &&
        data.serverId &&
        data.userId &&
        !joined.current.has(data.invitationId)
      ) {
        joined.current.add(data.invitationId);
        if (joined.current.size > 200)
          joined.current.delete(joined.current.values().next().value!);
        callback.current(data.serverId, data.userId);
      }
    },
    [refresh],
  );
  useEffect(() => {
    active.current = true;
    const currentEpoch = epoch.current;
    joined.current.clear();
    void refresh();
    const changed = (event: Event) =>
      receive((event as CustomEvent<Change | null>).detail);
    const focus = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("lc-server-invitations", changed);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      active.current = false;
      epoch.current = currentEpoch + 1;
      request.current?.abort();
      window.removeEventListener("lc-server-invitations", changed);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh, receive]);
  async function act(
    invite: ServerInvitation,
    action: "accept" | "decline" | "cancel",
  ) {
    const actionEpoch = epoch.current;
    const response = await fetch("/api/server-invitations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: invite.id, action }),
    });
    const result = await response.json();
    if (!active.current || actionEpoch !== epoch.current) return;
    if (!response.ok) {
      void refresh();
      throw new Error(result.error ?? "Invitation could not be updated.");
    }
    receive(
      result.accepted
        ? { invitationId: invite.id, serverId: invite.serverId, userId }
        : {},
    );
  }
  return {
    rows: view.userId === userId ? view.rows : [],
    ready: view.userId === userId && view.ready,
    error: view.userId === userId ? view.error : "",
    refresh,
    act,
  };
}
