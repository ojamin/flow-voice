import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';
import type { SpeechTransportOptions } from '../transport.js';
/** Deepgram v1: is_final commits a segment; speech_final/UtteranceEnd only delimit utterances.
 * https://developers.deepgram.com/reference/speech-to-text/listen-streaming
 * https://github.com/livekit/agents-js/blob/main/plugins/deepgram/src/stt.ts
 * Aura uses https://developers.deepgram.com/reference/text-to-speech/speak-request
 */
export declare function createDeepgramAdapters(config: ProviderEndpointConfig, transportOptions?: SpeechTransportOptions): {
    stt: SttAdapter;
    tts: TtsAdapter;
};
