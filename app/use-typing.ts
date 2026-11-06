"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

type Scope = { channelId?: string; userId?: string };
type Typist = { id: string; name: string };
export function typingLabel(users: Typist[]) {
  if (!users.length) return "";
  if (users.length === 1) return `${users[0].name} is typing…`;
  if (users.length === 2)
    return `${users[0].name} and ${users[1].name} are typing…`;
  return `${users[0].name}, ${users[1].name} and ${users.length - 2} ${users.length === 3 ? "other" : "others"} are typing…`;
}

export function useTyping(
  socket: RefObject<WebSocket | null>,
  accountId: string | undefined,
  { channelId, userId }: Scope,
) {
  const key = `${accountId ?? ""}:${channelId ?? ""}:${userId ?? ""}`;
  const [incoming, setIncoming] = useState<{ key: string; users: Typist[] }>({
    key: "",
    users: [],
  });
  const last = useRef<{
    key: string;
    scope: Scope;
    connection: WebSocket;
    at: number;
    active: boolean;
  } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const change = useCallback(
    (active: boolean) => {
      if (idle.current) clearTimeout(idle.current);
      if (!active) {
        const previous = last.current;
        if (previous?.active && previous.key === key) {
          previous.active = false;
          if (previous.connection.readyState === 1)
            previous.connection.send(
              JSON.stringify({
                type: "typing",
                ...previous.scope,
                active: false,
              }),
            );
        }
        return;
      }
      if (!accountId || (!channelId && !userId)) return;
      const connection = socket.current;
      if (!connection || connection.readyState !== 1) return;
      const previous = last.current,
        now = Date.now();
      if (
        !previous?.active ||
        previous.key !== key ||
        previous.connection !== connection ||
        now - previous.at >= 2000
      ) {
        connection.send(
          JSON.stringify({
            type: "typing",
            ...(channelId ? { channelId } : { userId }),
            active: true,
          }),
        );
        last.current = {
          key,
          connection,
          scope: channelId ? { channelId } : { userId },
          at: now,
          active: true,
        };
      }
      idle.current = setTimeout(() => {
        const current = last.current;
        if (current?.key === key && current.active) {
          current.active = false;
          if (current.connection.readyState === 1)
            current.connection.send(
              JSON.stringify({
                type: "typing",
                ...current.scope,
                active: false,
              }),
            );
        }
      }, 4000);
    },
    [socket, accountId, channelId, userId, key],
  );
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const update = (event: Event) => {
      const data = (
        event as CustomEvent<{
          channelId?: string;
          userId?: string;
          users?: Typist[];
        }>
      ).detail;
      if (
        !data ||
        (channelId
          ? data.channelId !== channelId
          : !userId || data.userId !== userId) ||
        !Array.isArray(data.users)
      )
        return;
      if (timeout) clearTimeout(timeout);
      setIncoming({
        key,
        users: data.users.filter(
          (user) =>
            user.id !== accountId &&
            typeof user.id === "string" &&
            typeof user.name === "string",
        ),
      });
      timeout = setTimeout(() => setIncoming({ key, users: [] }), 7000);
    };
    const hide = () => {
      change(false);
      setIncoming({ key, users: [] });
    };
    window.addEventListener("lc-typing", update);
    window.addEventListener("offline", hide);
    return () => {
      change(false);
      if (timeout) clearTimeout(timeout);
      window.removeEventListener("lc-typing", update);
      window.removeEventListener("offline", hide);
    };
  }, [key, accountId, channelId, userId, change]);
  return {
    change,
    label: incoming.key === key ? typingLabel(incoming.users) : "",
  };
}
