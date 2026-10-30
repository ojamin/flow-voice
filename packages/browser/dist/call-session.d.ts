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
export declare function createCallSession(options: CallSessionOptions): CallSession;
