"use client";
import { useState } from "react";

type Draft = { text: string; files: File[] };
const empty: Draft = { text: "", files: [] };

// The mounted workspace owns these drafts. No browser storage or server writes.
export function useConversationDraft(
  accountId: string | undefined,
  key: string | undefined,
) {
  const [store, setStore] = useState<{
    accountId: string | undefined;
    drafts: Record<string, Draft>;
  }>({ accountId, drafts: {} });
  // Reset before rendering a different account, including logout/login in one tab.
  if (store.accountId !== accountId) setStore({ accountId, drafts: {} });
  const draft =
    store.accountId === accountId && key ? (store.drafts[key] ?? empty) : empty;
  function update(patch: Partial<Draft>) {
    if (!accountId || !key) return;
    setStore((current) => {
      if (current.accountId !== accountId) return current;
      const next = { ...(current.drafts[key] ?? empty), ...patch };
      const drafts = { ...current.drafts };
      if (!next.text && !next.files.length) delete drafts[key];
      else drafts[key] = next;
      return { accountId, drafts };
    });
  }
  function clearSent() {
    if (!accountId || !key) return;
    setStore((current) => {
      // An upload can finish after navigation or after a newer draft was written.
      if (current.accountId !== accountId || current.drafts[key] !== draft)
        return current;
      const drafts = { ...current.drafts };
      delete drafts[key];
      return { accountId, drafts };
    });
  }
  return {
    text: draft.text,
    files: draft.files,
    setText: (text: string) => update({ text }),
    setFiles: (files: File[]) => update({ files }),
    clearSent,
  };
}
