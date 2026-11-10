import type { DictationController, DictationSnapshot } from '@flow-voice/browser';
/** Lifecycle belongs to the host; subscribing never acquires a microphone. */
export declare function useDictation(controller: DictationController): DictationSnapshot;
