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
    readonly maxSessionMs: 300000;
    readonly maxTextChars: 4000;
    readonly maxFrameBytes: 32000;
    readonly maxBufferedAudioBytes: 320000;
    readonly finalizationMs: 10000;
    readonly maxQueuedSections: 32;
};
