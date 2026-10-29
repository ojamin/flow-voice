import { useSyncExternalStore } from 'react';
import type {
  CallSession, CallSessionSnapshot, SpeechPreferences, VoiceMode, VoiceModeSnapshot,
} from '@flow-voice/browser';

export function useCallSession(session: CallSession): CallSessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
export function useVoiceMode(mode: VoiceMode): VoiceModeSnapshot {
  return useSyncExternalStore(mode.subscribe, mode.getSnapshot, mode.getSnapshot);
}
/** The chosen voice id for the scope, or undefined for the provider's default. */
export function useVoicePreference(preferences: SpeechPreferences, scope: string): string | undefined {
  const read = () => preferences.voice(scope);
  return useSyncExternalStore(preferences.subscribe, read, read);
}
export function useDictationPreference(
  preferences: SpeechPreferences,
  scope: string,
): ReturnType<SpeechPreferences['dictation']> {
  const read = () => preferences.dictation(scope);
  return useSyncExternalStore(preferences.subscribe, read, read);
}
