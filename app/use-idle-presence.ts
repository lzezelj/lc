"use client";
import { useEffect, useRef } from "react";
import type { UserStatus } from "./user-status-menu";

export const awayAfterMs = 10 * 60_000;
export const afkAfterMs = 15 * 60_000;

export function useIdlePresence(
  userId: string | undefined,
  options: {
    status: UserStatus;
    automaticAway: boolean;
    isSpeaking: () => boolean;
    onStatus: (status: UserStatus, automatic: boolean) => void;
    onAfk: () => void;
  },
) {
  const latest = useRef(options);
  const activity = useRef(() => {});
  useEffect(() => {
    latest.current = options;
  });
  useEffect(() => {
    if (!userId) return;
    const key = `lc.activity.${userId}`;
    let lastActivity = Date.now(),
      lastSaved = 0,
      lastAfk = 0;
    const sharedActivity = () => {
      try {
        const saved = Number(localStorage.getItem(key));
        if (Number.isFinite(saved) && saved <= Date.now())
          lastActivity = Math.max(lastActivity, saved);
      } catch {}
    };
    const restore = () => {
      if (latest.current.automaticAway && latest.current.status === "away")
        latest.current.onStatus("online", false);
    };
    const record = () => {
      lastActivity = Date.now();
      if (lastActivity - lastSaved >= 1000) {
        lastSaved = lastActivity;
        try {
          localStorage.setItem(key, String(lastActivity));
        } catch {}
      }
      restore();
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== key) return;
      sharedActivity();
      if (Date.now() - lastActivity < awayAfterMs) restore();
    };
    activity.current = record;
    record();
    const timer = window.setInterval(() => {
      if (latest.current.isSpeaking()) record();
      sharedActivity();
      const idle = Date.now() - lastActivity;
      if (idle >= awayAfterMs && latest.current.status === "online")
        latest.current.onStatus("away", true);
      else if (idle < awayAfterMs) restore();
      if (idle >= afkAfterMs && Date.now() - lastAfk >= 30_000) {
        lastAfk = Date.now();
        latest.current.onAfk();
      }
    }, 1000);
    const events = [
      "pointerdown",
      "pointermove",
      "keydown",
      "touchstart",
      "wheel",
    ];
    for (const event of events)
      window.addEventListener(event, record, { passive: true });
    window.addEventListener("storage", storage);
    return () => {
      clearInterval(timer);
      for (const event of events) window.removeEventListener(event, record);
      window.removeEventListener("storage", storage);
      activity.current = () => {};
    };
  }, [userId]);
  return () => activity.current();
}
