import { useSyncExternalStore } from 'react';
export function useCallSession(session) {
    return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
export function useVoiceMode(mode) {
    return useSyncExternalStore(mode.subscribe, mode.getSnapshot, mode.getSnapshot);
}
/** The chosen voice id for the scope, or undefined for the provider's default. */
export function useVoicePreference(preferences, scope) {
    const read = () => preferences.voice(scope);
    return useSyncExternalStore(preferences.subscribe, read, read);
}
export function useDictationPreference(preferences, scope) {
    const read = () => preferences.dictation(scope);
    return useSyncExternalStore(preferences.subscribe, read, read);
}
//# sourceMappingURL=voice.js.map