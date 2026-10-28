/** Shared half-duplex gate. Acquire before requesting the microphone; release after capture stops. */
export interface PlaybackGate {
  isMicrophoneActive(): boolean;
  acquireMicrophone(): () => void;
  subscribe(listener: () => void): () => void;
}
export function createPlaybackGate(): PlaybackGate {
  let holders = 0;
  const listeners = new Set<() => void>();
  return {
    isMicrophoneActive: () => holders > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    acquireMicrophone() {
      holders++;
      listeners.forEach((listener) => listener());
      let released = false;
      return () => {
        if (!released) {
          released = true;
          holders--;
          listeners.forEach((listener) => listener());
        }
      };
    },
  };
}
