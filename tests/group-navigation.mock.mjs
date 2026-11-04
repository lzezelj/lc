export const Track = {
  Kind: { Audio: "audio", Video: "video" },
  Source: { Microphone: "microphone", Camera: "camera", ScreenShare: "screen" },
};
export const TrackEvent = { Restarted: "restart" };
export const RoomEvent = new Proxy({}, { get: (_, name) => name });
export const DisconnectReason = {
  CLIENT_INITIATED: 1,
  DUPLICATE_IDENTITY: 2,
  PARTICIPANT_REMOVED: 4,
  ROOM_DELETED: 5,
};
export class Room {
  constructor() {
    this.events = new Map();
    this.engine = { client: { rtt: 0 } };
    this.remoteParticipants = new Map([
      [
        "remote",
        { identity: "remote", name: "Remote", trackPublications: new Map() },
      ],
    ]);
    this.localParticipant = {
      trackPublications: new Map(),
      getTrackPublication() {},
      async setMicrophoneEnabled() {},
    };
  }
  on(event, callback) {
    this.events.set(event, callback);
    return this;
  }
  async switchActiveDevice() {}
  async connect() {
    window.groupNavigation.connects++;
    const track = {
      kind: "audio",
      mediaStreamTrack: window.groupNavigation.stream.getAudioTracks()[0],
      volume: 1,
      elements: new Set(),
      setVolume(volume) {
        this.volume = volume;
        for (const element of this.elements) element.volume = volume;
      },
      attach(element) {
        window.groupNavigation.attaches++;
        this.elements.add(element);
        element.volume = this.volume;
        element.srcObject = window.groupNavigation.stream;
        void element.play();
      },
      detach(element) {
        window.groupNavigation.detaches++;
        this.elements.delete(element);
        element.srcObject = null;
      },
    };
    this.events.get("TrackSubscribed")?.(
      track,
      { trackSid: "remote-audio", source: "microphone" },
      { identity: "remote", name: "Remote" },
    );
  }
  async disconnect() {
    window.groupNavigation.disconnects++;
    this.events.get("Disconnected")?.();
  }
}
