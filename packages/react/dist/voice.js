import { useSyncExternalStore } from 'react';
export function useCallSession(session) {
    return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
export function useVoiceMode(mode) {
    return useSyncExternalStore(mode.subscribe, mode.getSnapshot, mode.getSnapshot);
}
//# sourceMappingURL=voice.js.map