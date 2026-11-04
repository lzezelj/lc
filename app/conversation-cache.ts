export type HistoryCursor = { beforeCreatedAt: string; beforeId: string };
export type CachedHistory<T> = {
  messages: T[];
  nextCursor: HistoryCursor | null;
};

// One mounted workspace owns this cache. Nothing is written to browser storage.
export class SessionCache<T> {
  private userId: string | undefined;
  private entries = new Map<string, { value: T; bytes: number }>();
  private bytes = 0;
  private maxBytes: number;
  private maxEntries: number;
  constructor(maxBytes = 5 * 1024 * 1024, maxEntries = 40) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }
  scope(userId: string | undefined) {
    if (this.userId === userId) return;
    this.clear();
    this.userId = userId;
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
  get(userId: string | undefined, key: string) {
    if (!userId || userId !== this.userId) return;
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  delete(userId: string | undefined, key: string) {
    if (!userId || userId !== this.userId) return;
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }
  set(userId: string | undefined, key: string, value: T) {
    if (!userId || userId !== this.userId) return;
    this.delete(userId, key);
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      this.delete(userId, this.entries.keys().next().value!);
    }
  }
}

export class ConversationCache<T extends { id: string }> extends SessionCache<
  CachedHistory<T>
> {}
