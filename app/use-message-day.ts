"use client";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
function notify() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(notify, 60000);
    window.addEventListener("focus", notify);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
      window.removeEventListener("focus", notify);
    }
  };
}
function currentDay() {
  return new Date().setHours(0, 0, 0, 0);
}
export function useMessageDay() {
  return useSyncExternalStore(subscribe, currentDay, () => 0);
}
