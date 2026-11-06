// Serialize sender parameter updates so rapid deafen/un-deafen uses the latest
// choice without stopping shared microphone/camera capture or renegotiating.
export function createAudioTransmissionGate(
  peer: RTCPeerConnection,
  onError: () => void,
) {
  let wanted = false,
    revision = 0,
    running = false;
  async function update(blocked: boolean) {
    wanted = blocked;
    revision++;
    if (running) return;
    running = true;
    try {
      let applied;
      do {
        applied = revision;
        if (peer.signalingState === "closed") return;
        for (const transceiver of peer.getTransceivers()) {
          if (transceiver.receiver.track.kind !== "audio") continue;
          const sender = transceiver.sender;
          const parameters = sender.getParameters();
          if (!parameters.encodings?.length) continue;
          if (
            parameters.encodings.every(
              (encoding) => (encoding.active !== false) === !wanted,
            )
          )
            continue;
          for (const encoding of parameters.encodings)
            encoding.active = !wanted;
          await sender.setParameters(parameters);
        }
      } while (applied !== revision);
    } catch {
      if (peer.signalingState !== "closed") onError();
    } finally {
      running = false;
    }
  }
  return { update };
}
