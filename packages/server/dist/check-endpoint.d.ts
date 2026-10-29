import type { Voice } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from './index.js';
export interface CheckSpeechEndpointOptions {
    stt?: SttAdapter;
    tts?: TtsAdapter;
    signal: AbortSignal;
    /** Total budget across both checks. Defaults to 15 seconds. */
    timeoutMs?: number;
}
export interface SpeechEndpointCheck {
    stt?: {
        ok: true;
        verified: true;
    };
    tts?: {
        ok: true;
        voices: readonly Voice[];
    };
}
/** Billable real-provider probe, not adapter construction or catalog-only validation. */
export declare function checkSpeechEndpoint(options: CheckSpeechEndpointOptions): Promise<SpeechEndpointCheck>;
