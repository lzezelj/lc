import { applyCallOutput } from "./audio-output";
import { playVoiceSound } from "./call-sounds";
import { loadSoundAudio } from "./soundboard-library";

type JoinSoundOptions = {
  serverId?: string;
  joinSoundId?: string | null;
  outputVolume?: number;
  outputId?: string;
  deafened?: boolean;
};

// Local notification only: never published into the voice call.
export class ServerJoinSoundPlayer {
  private generation = 0;
  private audio: HTMLAudioElement | null = null;
  private url = "";
  private options: JoinSoundOptions = {};

  update(options: JoinSoundOptions) {
    if (
      options.serverId !== this.options.serverId ||
      options.joinSoundId !== this.options.joinSoundId
    )
      this.stop();
    this.options = options;
    if (options.deafened) this.stop();
    else if (this.audio)
      void this.applyOutput(this.audio).catch(() => this.stop());
  }
  private applyOutput(audio: HTMLAudioElement) {
    return applyCallOutput(
      audio,
      this.options.outputVolume ?? 100,
      Boolean(this.options.deafened),
      this.options.outputId ?? "",
    );
  }
  stop() {
    this.generation++;
    if (this.audio) {
      this.audio.onended = null;
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
      this.audio = null;
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = "";
  }
  async play() {
    this.stop();
    const generation = this.generation;
    const { serverId, joinSoundId, deafened } = this.options;
    if (deafened || this.options.outputVolume === 0) return;
    if (!serverId || !joinSoundId) {
      playVoiceSound("join");
      return;
    }
    try {
      const bytes = await loadSoundAudio(serverId, joinSoundId);
      if (generation !== this.generation) return;
      const audio = new Audio();
      this.audio = audio;
      this.url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      audio.src = this.url;
      audio.onended = () => this.stop();
      await this.applyOutput(audio);
      if (generation !== this.generation) return;
      await audio.play();
    } catch {
      if (generation !== this.generation) return;
      this.stop();
      if (!this.options.deafened && this.options.outputVolume !== 0)
        playVoiceSound("join");
    }
  }
}
