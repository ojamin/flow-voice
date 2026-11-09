import { z } from 'zod';
/** A user's dictation choices. Hosts store them (per user, device or environment). */
export interface DictationPreference {
    /** Send after a pause in speech, with a countdown that can be cancelled. */
    sendAfterPause: boolean;
    silenceMs: number;
    /** Send when the transcript ends with `keyword`, which is removed. */
    sendOnWord: boolean;
    keyword: string;
    /** Leave the microphone off after a message is sent instead of listening for the next. */
    stopAfterSend: boolean;
}
export declare const SILENCE_MS: {
    readonly default: 1500;
    readonly min: 300;
    readonly max: 60000;
};
export declare const dictationPreferenceSchema: z.ZodObject<{
    sendAfterPause: z.ZodBoolean;
    silenceMs: z.ZodNumber;
    sendOnWord: z.ZodBoolean;
    keyword: z.ZodString;
    stopAfterSend: z.ZodBoolean;
}, z.core.$strict>;
export declare const DEFAULT_DICTATION_PREFERENCE: Readonly<DictationPreference>;
/** Accepts stored or partial input and returns a complete, valid preference. An older
 * `enabled` flag (one switch for both sends) migrates to both sends when they are unset. */
export declare function normalizeDictationPreference(value: unknown): DictationPreference;
export interface AutoSendSettings {
    enabled: boolean;
    silenceMs: number;
    keyword: string;
    afterPause: boolean;
}
/** The dictation controller's `autoSend` for a preference. On a call, a pause sends when the
 * user chose neither send, so a hands-free conversation always sends on its own. */
export declare function autoSendFor(preference: DictationPreference, { onCall }?: {
    onCall?: boolean;
}): AutoSendSettings;
