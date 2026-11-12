import type { SearchMessage } from "./conversation-search";

export async function resolveReplyTarget({
  targetId,
  messages,
  channelId,
  signal,
  fetcher = fetch,
}: {
  targetId: string;
  messages: { id: string; deleted?: boolean }[];
  channelId: string;
  signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<SearchMessage[] | null> {
  signal.throwIfAborted();
  const loaded = messages.find((message) => message.id === targetId);
  if (loaded) {
    if (loaded.deleted) throw new Error("This message is no longer available.");
    return null;
  }
  const params = new URLSearchParams({ channelId, contextId: targetId });
  const response = await fetcher(`/api/message-search?${params}`, { signal });
  const data = await response.json();
  signal.throwIfAborted();
  if (!response.ok)
    throw new Error(data.error ?? "The original message could not be loaded.");
  if (
    !Array.isArray(data.messages) ||
    !data.messages.some((message: SearchMessage) => message.id === targetId)
  )
    throw new Error("This message is no longer available.");
  return data.messages;
}
