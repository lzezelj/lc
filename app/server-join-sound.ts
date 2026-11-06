import { playVoiceSound } from "./call-sounds";

type JoinSoundOptions = {
  serverId?: string;
  outputVolume?: number;
  deafened?: boolean;
};

// Only the arriving client publishes a custom clip. Listeners use this to
// suppress the generated join tone when a soundboard announcement is selected.
export class ServerJoinSound {
  private generation = 0;
  private options: JoinSoundOptions = {};
  update(options: JoinSoundOptions) {
    if (options.serverId !== this.options.serverId) this.stop();
    this.options = options;
  }
  stop() {
    this.generation++;
  }
  private defaultTone() {
    if (!this.options.deafened && this.options.outputVolume !== 0)
      playVoiceSound("join");
  }
  async play(userId?: string, publishClip?: (clipId: string) => Promise<void>) {
    const generation = this.generation;
    const { serverId } = this.options;
    if (!serverId || !userId) {
      this.defaultTone();
      return;
    }
    try {
      const response = await fetch(
        `/api/servers/${serverId}/join-sound?userId=${encodeURIComponent(userId)}`,
      );
      if (!response.ok) throw new Error("Join sound unavailable");
      const { joinSoundId } = await response.json();
      if (generation !== this.generation) return;
      if (joinSoundId) await publishClip?.(joinSoundId);
      else this.defaultTone();
    } catch {
      if (generation === this.generation) this.defaultTone();
    }
  }
}
