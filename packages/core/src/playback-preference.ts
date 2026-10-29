import type { DictationPreference } from './preferences.js';

export interface PlaybackPreference {
  voice?: string;
  speed?: number;
  muted?: boolean;
}
/** One person's speech settings; how a host stores them is up to the host. */
export interface SpeechUserPreferences extends DictationPreference {
  voice?: string;
  language?: string;
  /** Per-speaker overrides keyed by the speaker's display name. */
  speakerVoices: Record<string, PlaybackPreference>;
}
