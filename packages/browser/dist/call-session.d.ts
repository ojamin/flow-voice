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
export declare function createCallSession(options: CallSessionOptions): CallSession;
