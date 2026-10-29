import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';
/** Exact speech gateway wire fields; endpoint prefixes are additionally supported. */
export declare function createMossCompatAdapters(config: ProviderEndpointConfig): {
    stt: SttAdapter;
    tts: TtsAdapter;
};
