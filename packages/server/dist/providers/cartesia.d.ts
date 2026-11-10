import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { TtsAdapter } from '../index.js';
import type { SpeechTransportOptions } from '../transport.js';
export declare function createCartesiaAdapters(config: ProviderEndpointConfig, transportOptions?: SpeechTransportOptions): {
    tts: TtsAdapter;
};
