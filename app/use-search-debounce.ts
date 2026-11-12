"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const SEARCH_DEBOUNCE_MS = 500;

// Keep the input responsive; delay only the work triggered by its value.
export function useDebouncedValue<T>(value: T) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return settled;
}

export function useDebouncedSearch<T extends unknown[]>(
  action: (...args: T) => void,
) {
  const latest = useRef(action);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = action;
  }, [action]);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const schedule = useCallback(
    (...args: T) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        latest.current(...args);
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancel],
  );
  return { schedule, cancel };
}
