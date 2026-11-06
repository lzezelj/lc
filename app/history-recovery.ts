type Cursor = { beforeCreatedAt: string; beforeId: string };
type Page<T> = { messages: T[]; nextCursor: Cursor | null };

// Recover the already loaded window, including missed edits/deletions in older
// pages. Undefined means a first visit; null means all history was loaded.
export async function readHistoryWindow<T>(
  load: (cursor?: Cursor) => Promise<Page<T>>,
  previousCursor?: Cursor | null,
): Promise<Page<T>> {
  let page = await load();
  let messages = page.messages;
  while (previousCursor !== undefined && page.nextCursor) {
    const next = page.nextCursor;
    if (
      previousCursor &&
      (next.beforeCreatedAt < previousCursor.beforeCreatedAt ||
        (next.beforeCreatedAt === previousCursor.beforeCreatedAt &&
          next.beforeId <= previousCursor.beforeId))
    )
      break;
    page = await load(next);
    if (
      page.nextCursor &&
      page.nextCursor.beforeCreatedAt === next.beforeCreatedAt &&
      page.nextCursor.beforeId === next.beforeId
    )
      throw new Error("Message history did not advance. Please retry.");
    messages = [...page.messages, ...messages];
  }
  return { messages, nextCursor: page.nextCursor };
}

export function reconcileRecoveredHistory<T extends { id: string }>(
  fresh: T[],
  current: T[],
  before: T[],
): T[] {
  const original = new Map(before.map((message) => [message.id, message]));
  const live = new Map(current.map((message) => [message.id, message]));
  const seen = new Set(fresh.map((message) => message.id));
  return [
    ...fresh
      .filter((message) => !original.has(message.id) || live.has(message.id))
      .map((message) => {
        const now = live.get(message.id);
        return now && now !== original.get(message.id) ? now : message;
      }),
    ...current.filter(
      (message) => !original.has(message.id) && !seen.has(message.id),
    ),
  ];
}
