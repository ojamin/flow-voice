import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';
import type { SpeechTransportOptions } from '../transport.js';
/** Exact speech gateway wire fields; endpoint prefixes are additionally supported. */
export declare function createMossCompatAdapters(config: ProviderEndpointConfig, transportOptions?: SpeechTransportOptions): {
    stt: SttAdapter;
    tts: TtsAdapter;
};
