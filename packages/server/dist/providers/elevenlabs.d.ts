import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';
import type { SpeechTransportOptions } from '../transport.js';
/** Scribe realtime uses manual commits so end() has an explicit final acknowledgement.
 * Pad short recordings to 300ms: Scribe rejects commits below its minimum duration.
 * Protocol: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime */
export declare function createElevenLabsAdapters(config: ProviderEndpointConfig, transportOptions?: SpeechTransportOptions): {
    stt: SttAdapter;
    tts: TtsAdapter;
};
