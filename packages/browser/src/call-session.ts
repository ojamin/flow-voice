import type { DictationController, ExternalStore, SpeechPlayer } from './index.js';

export interface CallSessionSnapshot {
  status: 'idle' | 'active';
  muted: boolean;
}
export type CallMediaAction = 'play' | 'pause' | 'nexttrack' | 'hangup' | 'togglemicrophone';
export interface CallMediaSession {
  playbackState: MediaSessionPlaybackState;
  setActionHandler(action: MediaSessionAction | CallMediaAction, handler: (() => void) | null): void;
  setMicrophoneActive?(active: boolean): void;
}
export interface CallSessionOptions {
  dictation: DictationController;
  player: SpeechPlayer;
  /** Enable Voice and return a callback restoring the host's previous Voice state. */
  onVoiceChange?(): () => void;
  /** Defaults to navigator.mediaSession; null disables integration. */
  mediaSession?: CallMediaSession | null;
  maxFailures?: number;
}
export interface CallSession extends ExternalStore<CallSessionSnapshot> {
  /** Invoke inside the user gesture, not from an effect. */
  start(): Promise<void>;
  setMuted(muted: boolean): void;
  end(): void;
  dispose(): void;
}

export function createCallSession(options: CallSessionOptions): CallSession {
  const { dictation, player } = options;
  const media: CallMediaSession | null | undefined = options.mediaSession === undefined
    ? globalThis.navigator?.mediaSession : options.mediaSession;
  let snapshot: CallSessionSnapshot = { status: 'idle', muted: false };
  let disposed = false;
  let generation = 0;
  let starting = false;
  let reachedListening = false;
  let failures = 0;
  let restoreVoice: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CallSessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const microphone = () => {
    try { media?.setMicrophoneActive?.(snapshot.status === 'active' && !snapshot.muted); }
    catch { /* Optional browser capability. */ }
  };
  const playback = () => {
    if (media && snapshot.status === 'active')
      media.playbackState = player.getSnapshot().status === 'playing' ? 'playing' : 'paused';
  };
  const handlers: Record<CallMediaAction, () => void> = {
    play: () => { void player.resume(); },
    pause: () => player.pause(),
    nexttrack: () => player.skipSection(),
    hangup: () => session.end(),
    togglemicrophone: () => session.setMuted(!snapshot.muted),
  };
  const actions = (enabled: boolean) => {
    for (const action of Object.keys(handlers) as CallMediaAction[]) {
      try { media?.setActionHandler(action, enabled ? handlers[action]! : null); }
      catch { /* Browsers can reject individual unsupported actions. */ }
    }
  };
  const shouldListen = () => snapshot.status === 'active' && !snapshot.muted && !disposed;
  const stopped = () => ['idle', 'error'].includes(dictation.getSnapshot().status);
  async function listen() {
    if (!shouldListen() || starting || !stopped()) return;
    starting = true;
    reachedListening = false;
    const attempt = generation;
    try {
      await dictation.start();
      if (attempt !== generation || !shouldListen()) return;
      if (reachedListening || dictation.getSnapshot().status === 'listening') failures = 0;
      else failures++;
    } catch {
      if (attempt === generation && shouldListen()) failures++;
    } finally {
      starting = false;
      if (shouldListen()) {
        if (failures >= (options.maxFailures ?? 3)) session.end();
        else if (stopped()) queueMicrotask(() => { void listen(); });
      }
    }
  }
  const unsubscribeDictation = dictation.subscribe(() => {
    if (dictation.getSnapshot().status === 'listening') {
      reachedListening = true;
      failures = 0;
    }
    if (shouldListen() && !starting && stopped())
      queueMicrotask(() => { if (stopped()) void listen(); });
  });
  const unsubscribePlayer = player.subscribe(playback);
  const session: CallSession = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      if (disposed || snapshot.status === 'active') return;
      generation++;
      failures = 0;
      publish({ status: 'active', muted: false });
      // All three calls happen in the gesture, before the first await.
      const capture = listen();
      const unlock = player.unlock();
      const background = player.setBackgroundAudio(true);
      restoreVoice = options.onVoiceChange?.();
      actions(true);
      microphone();
      playback();
      await Promise.all([capture, unlock, background]);
    },
    setMuted(muted) {
      if (snapshot.status !== 'active' || snapshot.muted === muted) return;
      generation++;
      publish({ muted });
      microphone();
      if (muted) void dictation.cancel();
      else void listen();
    },
    end() {
      if (snapshot.status === 'idle') return;
      generation++;
      publish({ status: 'idle', muted: false });
      void dictation.cancel();
      void player.setBackgroundAudio(false);
      actions(false);
      microphone();
      if (media) media.playbackState = 'none';
      const restore = restoreVoice;
      restoreVoice = undefined;
      restore?.();
    },
    dispose() {
      session.end();
      disposed = true;
      unsubscribeDictation();
      unsubscribePlayer();
      listeners.clear();
    },
  };
  return session;
}
