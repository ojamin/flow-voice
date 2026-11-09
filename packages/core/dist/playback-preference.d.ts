import type { DictationPreference } from './preferences.js';
export interface PlaybackPreference {
    voice?: string;
    speed?: number;
    muted?: boolean;
}
/** Account defaults, then the user's nonempty voice, then the speaker override. */
export declare function resolvePlaybackPreference({ defaults, preference, override }: {
    defaults?: PlaybackPreference;
    preference?: PlaybackPreference;
    override?: PlaybackPreference;
}): PlaybackPreference;
/** One person's speech settings; how a host stores them is up to the host. */
export interface SpeechUserPreferences extends DictationPreference {
    voice?: string;
    language?: string;
    /** Per-speaker overrides keyed by the speaker's display name. */
    speakerVoices: Record<string, PlaybackPreference>;
}
