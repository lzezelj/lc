export function reserveScreenAudio(
  peer: RTCPeerConnection,
  stream: MediaStream | null,
  context: AudioContext,
) {
  // addTrack makes this transceiver reusable when answering an offer. An empty
  // addTransceiver slot can otherwise remain unassociated and receive no media.
  const silent = context.createMediaStreamDestination();
  const placeholder = silent.stream.getAudioTracks()[0];
  const sender = peer.addTrack(
    stream?.getAudioTracks()[0] ?? placeholder,
    stream ?? silent.stream,
  );
  const transceiver = peer
    .getTransceivers()
    .find((item) => item.sender === sender)!;
  return {
    sender,
    receiver: transceiver.receiver,
    transceiver,
    stop: () => placeholder.stop(),
  };
}
