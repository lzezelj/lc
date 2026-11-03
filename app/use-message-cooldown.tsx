"use client";

import { useEffect, useRef, useState } from "react";

export function useMessageCooldown() {
  const deadline = useRef(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!seconds) return;
    const timer = window.setInterval(() => {
      setSeconds(
        Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000)),
      );
    }, 200);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return {
    seconds,
    blocked: () => deadline.current > Date.now(),
    handleResponse(response: Response) {
      if (response.status !== 429) return false;
      const retry = response.headers.get("Retry-After");
      const numeric = retry === null ? NaN : Number(retry);
      const duration = Number.isFinite(numeric)
        ? numeric * 1000
        : Date.parse(retry ?? "") - Date.now();
      // Missing or malformed headers still provide a short, recoverable wait.
      deadline.current = Math.max(
        deadline.current,
        Date.now() +
          (Number.isFinite(duration) && duration > 0 ? duration : 1000),
      );
      setSeconds(
        Math.max(1, Math.ceil((deadline.current - Date.now()) / 1000)),
      );
      return true;
    },
  };
}
