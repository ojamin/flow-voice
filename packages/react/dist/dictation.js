import { useSyncExternalStore } from 'react';
/** Lifecycle belongs to the host; subscribing never acquires a microphone. */
export function useDictation(controller) {
    return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
//# sourceMappingURL=dictation.js.map