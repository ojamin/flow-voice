import { type ComposerAdapter, type ComposerSpeechOptions, type ComposerSpeech, type SpeechSession, type SpeechSessionConfig } from '@flow-voice/browser';
/** Owns only the binding, never the session. Preferences are read at decision time, not captured. */
export declare function useComposerSpeech(options: {
    session: SpeechSession | null;
    composer: ComposerAdapter | null;
    owner: unknown;
    enabled?: boolean;
    config: SpeechSessionConfig;
    preferences: ReturnType<ComposerSpeechOptions['preferences']>;
    activityTarget?: EventTarget;
}): {
    controller: ComposerSpeech['dictation'] | null;
    call: ComposerSpeech['call'];
};
