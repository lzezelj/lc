import type {
  Track,
  TrackProcessor,
  VideoProcessorOptions,
} from "livekit-client";
import { readMirror } from "./camera-mirror";

const sources = new WeakMap<MediaStreamTrack, MediaStreamTrack>();
export function cameraSource(track: MediaStreamTrack) {
  return sources.get(track) ?? track;
}

// Camera frames only: screen capture never enters this pipeline.
export class CameraMirrorProcessor implements TrackProcessor<
  Track.Kind.Video,
  VideoProcessorOptions
> {
  name = "lc-camera-mirror";
  processedTrack?: MediaStreamTrack;
  private video?: HTMLVideoElement;
  private cancel?: () => void;
  private generation = 0;
  async init({ track }: VideoProcessorOptions) {
    const generation = ++this.generation;
    const video = document.createElement("video");
    this.video = video;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    await video.play();
    if (generation !== this.generation) {
      video.pause();
      video.srcObject = null;
      return;
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context || !canvas.captureStream)
      throw new Error("Camera mirroring is unavailable in this browser.");
    const resize = () => {
      const settings = track.getSettings();
      const width = video.videoWidth || settings.width || 1280;
      const height = video.videoHeight || settings.height || 720;
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    };
    resize();
    const stream = canvas.captureStream(60);
    this.processedTrack = stream.getVideoTracks()[0];
    this.processedTrack.contentHint = "detail";
    sources.set(this.processedTrack, track);
    let callback = 0;
    const draw = () => {
      if (generation !== this.generation) return;
      resize();
      const mirrored = readMirror();
      context.setTransform(
        mirrored ? -1 : 1,
        0,
        0,
        1,
        mirrored ? canvas.width : 0,
        0,
      );
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      callback = video.requestVideoFrameCallback
        ? video.requestVideoFrameCallback(draw)
        : requestAnimationFrame(draw);
    };
    this.cancel = () => {
      if (video.cancelVideoFrameCallback)
        video.cancelVideoFrameCallback(callback);
      else cancelAnimationFrame(callback);
    };
    draw();
  }
  async restart(options: VideoProcessorOptions) {
    await this.destroy();
    await this.init(options);
  }
  async destroy() {
    this.generation++;
    this.cancel?.();
    this.cancel = undefined;
    this.video?.pause();
    if (this.video) this.video.srcObject = null;
    this.video = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
  }
}

export async function captureCamera(video: MediaTrackConstraints) {
  const raw = await navigator.mediaDevices.getUserMedia({ video });
  const source = raw.getVideoTracks()[0];
  const processor = new CameraMirrorProcessor();
  try {
    await processor.init({ kind: "video" as Track.Kind.Video, track: source });
    const output = processor.processedTrack!;
    const stopOutput = output.stop.bind(output);
    // The native call owns both tracks; LiveKit owns its source separately.
    output.stop = () => {
      output.stop = stopOutput;
      void processor.destroy();
      source.stop();
    };
    source.addEventListener("ended", () => output.stop(), { once: true });
    return new MediaStream([output]);
  } catch (error) {
    await processor.destroy();
    raw.getTracks().forEach((track) => track.stop());
    throw error;
  }
}
