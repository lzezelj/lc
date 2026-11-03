export class SoundCache {
  private entries = new Map<string, ArrayBuffer>();
  private bytes = 0;
  constructor(
    private maxBytes = 4 * 1024 * 1024,
    private maxEntries = 24,
  ) {}
  async get(key: string, load: () => Promise<ArrayBuffer>) {
    const cached = this.entries.get(key);
    if (cached) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached;
    }
    const value = await load();
    if (value.byteLength > this.maxBytes) throw new Error("Sound is too large");
    // Another request may have filled this key while loading.
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.byteLength;
    this.entries.delete(key);
    this.entries.set(key, value);
    this.bytes += value.byteLength;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value!;
      this.bytes -= this.entries.get(oldest)!.byteLength;
      this.entries.delete(oldest);
    }
    return value;
  }
}

export type PublishSound = (track: MediaStreamTrack) => Promise<() => void>;

export class SoundCooldown {
  private next = 0;
  take(now = Date.now()) {
    if (now < this.next) return false;
    this.next = now + 1000;
    return true;
  }
}

// Owns capture independently of microphone mute/gating and of the board dialog.
export class SoundPlayer {
  constructor(private monitor?: (track: MediaStreamTrack) => () => void) {}
  private generation = 0;
  private release: (() => void) | null = null;
  stop() {
    this.generation++;
    this.release?.();
    this.release = null;
  }
  async play(
    context: AudioContext,
    load: () => Promise<ArrayBuffer>,
    publish: PublishSound,
  ) {
    this.stop();
    const generation = this.generation;
    const buffer = await context.decodeAudioData((await load()).slice(0));
    if (generation !== this.generation) return;
    const destination = context.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    let unpublish: (() => void) | undefined;
    let stopActivity: (() => void) | undefined;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
      stopActivity?.();
      track.stop();
      unpublish?.();
    };
    this.release = release;
    try {
      unpublish = await publish(track);
      if (generation !== this.generation) {
        unpublish();
        release();
        return;
      }
      source.onended = () => this.stop();
      source.start();
      stopActivity = this.monitor?.(track);
    } catch (error) {
      release();
      throw error;
    }
  }
}
