import type { CallSession, CallSessionSnapshot, SpeechPreferences, VoiceMode, VoiceModeSnapshot } from '@flow-voice/browser';
export declare function useCallSession(session: CallSession): CallSessionSnapshot;
export declare function useVoiceMode(mode: VoiceMode): VoiceModeSnapshot;
/** The chosen voice id for the scope, or undefined for the provider's default. */
export declare function useVoicePreference(preferences: SpeechPreferences, scope: string): string | undefined;
export declare function useDictationPreference(preferences: SpeechPreferences, scope: string): ReturnType<SpeechPreferences['dictation']>;
