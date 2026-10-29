import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { TtsAdapter } from '../index.js';
export declare function createCartesiaAdapters(config: ProviderEndpointConfig): {
    tts: TtsAdapter;
};
