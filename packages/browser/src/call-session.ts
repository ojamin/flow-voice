import type { DictationController, ExternalStore, SpeechPlayer } from './index.js';

export interface CallSessionSnapshot {
  status: 'idle' | 'active';
  muted: boolean;
  /** The last call ended because the microphone or speech service kept failing. */
  failed: boolean;
}
export type CallMediaAction = 'play' | 'pause' | 'nexttrack' | 'hangup' | 'togglemicrophone';
export interface CallMediaSession {
  playbackState: MediaSessionPlaybackState;
  metadata?: MediaMetadata | null;
  setActionHandler(action: MediaSessionAction | CallMediaAction, handler: (() => void) | null): void;
  setMicrophoneActive?(active: boolean): void;
}
export interface CallSessionOptions {
  /** The chat's dictation; null while no composer for the chat is mounted (see setDictation). */
  dictation: DictationController | null;
  player: SpeechPlayer;
  /** Enable Voice and return a callback restoring the host's previous Voice state. */
  onVoiceChange?(): () => void;
  /** Defaults to navigator.mediaSession; null disables integration. */
  mediaSession?: CallMediaSession | null;
  /** What the system's media controls show for the call, for example `{ title: 'Voice call' }`. */
  metadata?: MediaMetadataInit;
  maxFailures?: number;
}
export interface CallSession extends ExternalStore<CallSessionSnapshot> {
  /** Invoke inside the user gesture, not from an effect. */
  start(): Promise<void>;
  setMuted(muted: boolean): void;
  /** Follow the composer that now owns the chat (after a remount), or null while none does.
   * The call waits without counting failures until a controller is bound again. */
  setDictation(dictation: DictationController | null): void;
  /** Hang up: the microphone and Voice return to how they were before the call. */
  end(): void;
  dispose(): void;
}

export function createCallSession(options: CallSessionOptions): CallSession {
  const { player } = options;
  const media: CallMediaSession | null | undefined = options.mediaSession === undefined
    ? globalThis.navigator?.mediaSession : options.mediaSession;
  let dictation = options.dictation;
  let snapshot: CallSessionSnapshot = { status: 'idle', muted: false, failed: false };
  let disposed = false;
  let generation = 0;
  let starting = false;
  let reachedListening = false;
  let failures = 0;
  let restoreVoice: (() => void) | undefined;
  /** Dictation was on when the call started, so hanging up leaves it on. */
  let restoreDictation = false;
  let setMetadata = false;
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
  const stopped = () => !dictation || ['idle', 'error'].includes(dictation.getSnapshot().status);
  async function listen() {
    const target = dictation;
    if (!target || !shouldListen() || starting || !stopped()) return;
    starting = true;
    reachedListening = false;
    const attempt = generation;
    try {
      await target.start();
      if (attempt !== generation || target !== dictation || !shouldListen()) return;
      if (reachedListening || target.getSnapshot().status === 'listening') failures = 0;
      else failures++;
    } catch {
      if (attempt === generation && target === dictation && shouldListen()) failures++;
    } finally {
      starting = false;
      if (shouldListen() && dictation) {
        if (failures >= (options.maxFailures ?? 3)) finish(true);
        else if (stopped()) queueMicrotask(() => { void listen(); });
      }
    }
  }
  const onDictation = () => {
    if (dictation?.getSnapshot().status === 'listening') {
      reachedListening = true;
      failures = 0;
    }
    if (shouldListen() && !starting && stopped())
      queueMicrotask(() => { if (stopped()) void listen(); });
  };
  let unsubscribeDictation = dictation?.subscribe(onDictation);
  const unsubscribePlayer = player.subscribe(playback);
  function finish(failed: boolean) {
    if (snapshot.status === 'idle') return;
    generation++;
    publish({ status: 'idle', muted: false, failed });
    if (restoreDictation && !failed) {
      if (dictation && stopped()) void dictation.start().catch(() => {});
    } else void dictation?.cancel();
    void player.setBackgroundAudio(false);
    actions(false);
    microphone();
    if (media) {
      media.playbackState = 'none';
      if (setMetadata) media.metadata = null;
    }
    setMetadata = false;
    const restore = restoreVoice;
    restoreVoice = undefined;
    restore?.();
  }
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
      const status = dictation?.getSnapshot().status;
      restoreDictation = status === 'connecting' || status === 'listening';
      publish({ status: 'active', muted: false, failed: false });
      // All three calls happen in the gesture, before the first await.
      const capture = listen();
      const unlock = player.unlock();
      const background = player.setBackgroundAudio(true);
      restoreVoice = options.onVoiceChange?.();
      if (media && options.metadata && typeof MediaMetadata !== 'undefined') {
        media.metadata = new MediaMetadata(options.metadata);
        setMetadata = true;
      }
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
      if (muted) void dictation?.cancel();
      else void listen();
    },
    setDictation(next) {
      if (next === dictation) return;
      unsubscribeDictation?.();
      dictation = next;
      unsubscribeDictation = next?.subscribe(onDictation);
      if (shouldListen()) void listen();
    },
    end: () => finish(false),
    dispose() {
      finish(false);
      disposed = true;
      unsubscribeDictation?.();
      unsubscribePlayer();
      listeners.clear();
    },
  };
  return session;
}
