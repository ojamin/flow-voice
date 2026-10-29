import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';
/** OpenAI native GA transcription session, verified against realtime-transcription guide 2026-10-28. */
export declare function createOpenAIAdapters(config: ProviderEndpointConfig): {
    stt: SttAdapter;
    tts: TtsAdapter;
};
