export function isLocalPicture(source: string) {
  return /^\/api\/(?:users\/[\w-]+\/avatar|servers\/[\w-]+\/picture)\?v=[\w-]+$/.test(
    source,
  );
}
type Entry = {
  promise: Promise<string>;
  refs: number;
  bytes: number;
  url?: string;
  abort: AbortController;
};
export class PictureCache {
  private entries = new Map<string, Entry>();
  private maxBytes: number;
  private maxEntries: number;
  private download: typeof fetch;
  private createUrl: (blob: Blob) => string;
  private revokeUrl: (url: string) => void;
  constructor(
    maxBytes = 8 * 1024 * 1024,
    maxEntries = 64,
    download: typeof fetch = (...args) => fetch(...args),
    createUrl = (blob: Blob) => URL.createObjectURL(blob),
    revokeUrl = (url: string) => URL.revokeObjectURL(url),
  ) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.download = download;
    this.createUrl = createUrl;
    this.revokeUrl = revokeUrl;
  }
  peek(source: string) {
    return this.entries.get(source)?.url;
  }
  acquire(source: string) {
    if (!isLocalPicture(source)) throw new Error("Unsupported picture URL");
    let entry = this.entries.get(source);
    if (!entry) {
      const abort = new AbortController();
      entry = { promise: Promise.resolve(""), refs: 0, bytes: 0, abort };
      const current = entry;
      current.promise = this.download(source, {
        signal: abort.signal,
        cache: "no-store",
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Picture unavailable");
          const blob = await response.blob();
          if (abort.signal.aborted || this.entries.get(source) !== current)
            throw new Error("Picture request expired");
          if (blob.type !== "image/png" || blob.size > 512 * 1024)
            throw new Error("Invalid picture");
          current.bytes = blob.size;
          current.url = this.createUrl(blob);
          this.trim();
          return current.url;
        })
        .catch((error) => {
          if (this.entries.get(source) === current) this.entries.delete(source);
          throw error;
        });
      this.entries.set(source, current);
    }
    this.entries.delete(source);
    this.entries.set(source, entry);
    entry.refs++;
    const current = entry;
    let released = false;
    this.trim();
    return {
      promise: current.promise,
      release: () => {
        if (released) return;
        released = true;
        current.refs--;
        this.trim();
      },
    };
  }
  private trim() {
    let bytes = [...this.entries.values()].reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    );
    for (const [key, entry] of this.entries) {
      if (bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
      if (entry.refs > 0) continue;
      this.entries.delete(key);
      bytes -= entry.bytes;
      entry.abort.abort();
      if (entry.url) this.revokeUrl(entry.url);
    }
  }
  clear() {
    for (const entry of this.entries.values()) {
      entry.abort.abort();
      if (entry.url) this.revokeUrl(entry.url);
    }
    this.entries.clear();
  }
}
