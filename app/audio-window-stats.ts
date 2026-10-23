type AudioCounters = {
  received: number;
  lost: number;
  concealed: number;
  samples: number;
};

export function createAudioWindowStats() {
  let previous: AudioCounters | null = null;
  return (current: AudioCounters) => {
    const before = previous;
    previous = current;
    if (
      !before ||
      current.received < before.received ||
      current.samples < before.samples
    )
      return "measuring…";
    const received = current.received - before.received;
    const lost = Math.max(0, current.lost - before.lost);
    const total = received + lost;
    const samples = current.samples - before.samples;
    const concealed = Math.max(0, current.concealed - before.concealed);
    return `loss ${total ? ((lost / total) * 100).toFixed(1) : "0.0"}% / concealed ${samples ? ((concealed / samples) * 100).toFixed(1) : "0.0"}%`;
  };
}
