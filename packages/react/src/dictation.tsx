import { useSyncExternalStore } from 'react';
import type { DictationController, DictationSnapshot } from '@flow-voice/browser';

/** Lifecycle belongs to the host; subscribing never acquires a microphone. */
export function useDictation(controller: DictationController): DictationSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
