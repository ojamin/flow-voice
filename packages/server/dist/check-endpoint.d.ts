import type { ProviderEndpointConfig, Voice } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from './index.js';
import type { SpeechTransportOptions } from './transport.js';
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
        live?: boolean;
    };
    tts?: {
        ok: true;
        voices: readonly Voice[];
    };
    models?: string[];
    /** Corrected address, only when the single /v1 retry succeeded. */
    baseUrl?: string;
    /** Voice discovery failed; no TTS synthesis was verified. Safe to forward verbatim. */
    voiceError?: string;
}
type Adapters = {
    stt?: SttAdapter;
    tts?: TtsAdapter;
};
type EndpointFactory = (config: ProviderEndpointConfig, transport?: SpeechTransportOptions) => Adapters;
export declare function registerEndpointAdapters<T extends Adapters>(config: ProviderEndpointConfig, transport: SpeechTransportOptions, factory: EndpointFactory, adapters: T): T;
/** Billable real-provider probe, not adapter construction or catalog-only validation. */
export declare function checkSpeechEndpoint(options: CheckSpeechEndpointOptions): Promise<SpeechEndpointCheck>;
export {};
