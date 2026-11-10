import type { SttAdapter, TtsAdapter } from './index.js';
/** Deterministic network-free fixtures. A final is emitted for each accepted frame, followed
 * by ended. Text/PCM are synthetic; this does not model recognition quality or timing. */
export declare function createFakeAdapters(options?: {
    transcript?: string;
    pcm?: Uint8Array;
}): {
    stt: SttAdapter;
    tts: TtsAdapter;
};
