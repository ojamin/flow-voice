import { z } from 'zod';
/** Known endpoint families; capability discovery belongs to the adapter, not this list. */
export declare const PROVIDER_IDS: readonly ['openai', 'elevenlabs', 'cartesia', 'xai', 'azure', 'google', 'deepgram', 'groq', 'assemblyai', 'mistral', 'moss-compat', 'speechmatics', 'gladia', 'rev.ai', 'fake'];
export type ProviderId = (typeof PROVIDER_IDS)[number] | (string & {});
export type SpeechKind = 'stt' | 'tts';
export type ProviderOptions = Record<string, unknown>;
/** Credentials are server-only. Custom/self-hosted services use baseUrl, not a special mode. */
export interface ProviderEndpointConfig {
    provider: ProviderId;
    model: string;
    baseUrl?: string;
    apiKey?: string;
    options?: ProviderOptions;
}
/** Runtime facts declared by native adapters, not inferred from the provider id. */
export interface SttCapabilities {
    live: true;
    interim: boolean;
    sampleRates: readonly number[];
    languages?: readonly string[];
}
export interface TtsCapabilities {
    streamingAudio: boolean;
    streamingText: boolean;
    /** Request-selectable formats only; response-reported providers may advertise none. */
    formats: readonly AudioFormat[];
    voices: 'list' | 'fixed' | 'none';
}
export interface ProviderCapabilities {
    stt?: SttCapabilities;
    tts?: TtsCapabilities;
}
export interface Voice {
    id: string;
    name: string;
    language?: string;
    /** Provider-selected default, independent of account preferences. */
    isDefault?: boolean;
}
export declare const voiceSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    language: z.ZodOptional<z.ZodString>;
    isDefault: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type AudioFormat = {
    kind: 'pcm';
    encoding: 'pcm_s16le';
    sampleRate: number;
    channels: 1 | 2;
} | {
    kind: 'encoded';
    mimeType: string;
};
export interface SynthesisRequest {
    text: string;
    voice?: string;
    speed?: number;
    language?: string;
}
export interface SynthesisAudio {
    stream: ReadableStream<Uint8Array>;
    format: AudioFormat;
    mimeType: string;
}
export declare const DEFAULT_LIMITS: {
    /** No session cap: dictation lasts until it is stopped. Hosts may still set one. */
    readonly maxSessionMs: number;
    /** Per synthesis request. Speech sections stay far below it; messages are not capped. */
    readonly maxTextChars: 4000;
    readonly maxFrameBytes: 32000;
    readonly maxBufferedAudioBytes: 320000;
    readonly finalizationMs: 10000;
    /** The player queues a whole reply, however long. */
    readonly maxQueuedSections: number;
};
/** Browser timers fire at once past this delay, so longer limits mean "no limit". */
export declare const MAX_TIMER_MS = 2147483647;
