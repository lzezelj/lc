// WebSocket delivery is ordered, but async message handlers aren't. Apply SDP
// and candidates in the same order as their signaling messages arrive.
export function createSignalQueue<T>(
  handle: (message: T) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let pending = Promise.resolve();
  return (message: T) => {
    pending = pending.then(() => handle(message)).catch(onError);
    return pending;
  };
}
