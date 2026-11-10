import type { DictationPreference } from '@flow-voice/core';
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** A user's speech choices per scope (a host's environment, workspace or account). */
export interface SpeechPreferences {
    /** The chosen voice id, or undefined for the provider's default. */
    voice(scope: string): string | undefined;
    /** An empty id goes back to the provider's default. */
    setVoice(scope: string, voice: string): void;
    dictation(scope: string): DictationPreference;
    setDictation(scope: string, patch: Partial<DictationPreference>): void;
    subscribe(listener: () => void): () => void;
}
export interface SpeechPreferencesOptions {
    /** Defaults to localStorage; null keeps choices for the page's lifetime only. */
    storage?: PreferenceStorage | null;
    voiceKey?(scope: string): string;
    dictationKey?(scope: string): string;
}
/** Persisted speech choices. Storage that is unavailable or holds stale data never throws:
 * choices then last for the page's lifetime and the defaults apply. */
export declare function createSpeechPreferences(options?: SpeechPreferencesOptions): SpeechPreferences;
export {};
