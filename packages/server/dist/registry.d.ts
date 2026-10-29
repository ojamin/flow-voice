import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from './index.js';
export declare function createAdapters(config: ProviderEndpointConfig): {
    stt?: SttAdapter;
    tts?: TtsAdapter;
};
