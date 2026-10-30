import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from './index.js';
import type { SpeechTransportOptions } from './transport.js';
export declare function createAdapters(config: ProviderEndpointConfig, options?: SpeechTransportOptions): {
    stt?: SttAdapter;
    tts?: TtsAdapter;
};
