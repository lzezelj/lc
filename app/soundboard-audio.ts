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
  // Encoded buffers are owned by the bounded audio LRU. Weak keys let decoded
  // audio go with those buffers without retaining another unbounded clip list.
  private decoded = new WeakMap<
    AudioContext,
    WeakMap<ArrayBuffer, Promise<AudioBuffer>>
  >();
  private async decode(
    context: AudioContext,
    load: () => Promise<ArrayBuffer>,
  ) {
    const bytes = await load();
    let buffers = this.decoded.get(context);
    if (!buffers) {
      buffers = new WeakMap();
      this.decoded.set(context, buffers);
    }
    let pending = buffers.get(bytes);
    if (!pending) {
      pending = context.decodeAudioData(bytes.slice(0));
      buffers.set(bytes, pending);
      void pending.catch(() => buffers.delete(bytes));
    }
    return pending;
  }
  constructor(
    private monitor?: (track: MediaStreamTrack) => () => void,
    private onPlayingChange?: (playing: boolean) => void,
    private keepReady = false,
  ) {}
  private output: {
    context: AudioContext;
    destination: MediaStreamAudioDestinationNode;
    track: MediaStreamTrack;
    pending: Promise<void>;
    unpublish?: () => void;
  } | null = null;
  async preload(context: AudioContext, load: () => Promise<ArrayBuffer>) {
    await this.decode(context, load);
  }
  async prepare(context: AudioContext, publish: PublishSound) {
    if (!this.keepReady) return;
    if (
      this.output?.context === context &&
      this.output.track.readyState !== "ended"
    ) {
      await this.output.pending;
      return;
    }
    if (this.output) this.stop();
    const destination = context.createMediaStreamDestination();
    const output = {
      context,
      destination,
      track: destination.stream.getAudioTracks()[0],
      pending: Promise.resolve(),
      unpublish: undefined as (() => void) | undefined,
    };
    this.output = output;
    output.pending = (async () => {
      try {
        const unpublish = await publish(output.track);
        if (this.output !== output) unpublish();
        else output.unpublish = unpublish;
      } catch (error) {
        if (this.output === output) this.stop();
        throw error;
      }
    })();
    await output.pending;
  }
  private generation = 0;
  private release: (() => void) | null = null;
  private stopClip() {
    this.generation++;
    this.release?.();
    this.release = null;
  }
  stop() {
    this.stopClip();
    const output = this.output;
    this.output = null;
    output?.track.stop();
    output?.unpublish?.();
  }
  async play(
    context: AudioContext,
    load: () => Promise<ArrayBuffer>,
    publish: PublishSound,
    authorize: () => Promise<void> = async () => {},
  ) {
    if (this.keepReady) this.stopClip();
    else this.stop();
    const generation = this.generation;
    const [buffer] = await Promise.all([
      this.decode(context, load),
      authorize(),
    ]);
    if (generation !== this.generation) return;
    if (this.keepReady) {
      await this.prepare(context, publish);
      if (generation !== this.generation || !this.output) return;
    }
    const activeGeneration = this.generation;
    const readyOutput = this.keepReady ? this.output : null;
    const destination =
      readyOutput?.destination ?? context.createMediaStreamDestination();
    const track = destination.stream.getAudioTracks()[0];
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    let unpublish: (() => void) | undefined;
    let stopActivity: (() => void) | undefined;
    let released = false;
    let playing = false;
    const release = () => {
      if (released) return;
      released = true;
      source.onended = null;
      try {
        source.stop();
      } catch {}
      source.disconnect();
      stopActivity?.();
      if (playing) {
        playing = false;
        this.onPlayingChange?.(false);
      }
      if (!readyOutput) {
        track.stop();
        unpublish?.();
      }
    };
    this.release = release;
    try {
      unpublish = readyOutput ? undefined : await publish(track);
      if (activeGeneration !== this.generation) {
        unpublish?.();
        release();
        return;
      }
      source.onended = () => (this.keepReady ? this.stopClip() : this.stop());
      source.start();
      playing = true;
      this.onPlayingChange?.(true);
      stopActivity = this.monitor?.(track);
    } catch (error) {
      release();
      throw error;
    }
  }
}
