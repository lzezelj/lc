// Shared media is music/system audio, not speech. Browser/OS support determines
// which capture constraints are honored.
export const sharedAudioCapture = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 2,
};

export const sharedAudioPublish = {
  audioPreset: { maxBitrate: 192_000 },
  dtx: false,
  forceStereo: true,
};

export async function preferSharedAudio(sender: RTCRtpSender) {
  const parameters = sender.getParameters();
  parameters.encodings ??= [{}];
  for (const encoding of parameters.encodings) encoding.maxBitrate = 192_000;
  try {
    await sender.setParameters(parameters);
  } catch {
    // Some browsers do not allow changing encoder parameters after negotiation.
  }
}
