import type {
  AudioFormat,
  PcmInput,
  SpeechErrorCode,
  SttCapabilities,
  TtsCapabilities,
  SttClientMessage,
  SttServerMessage,
  SynthesisRequest,
  SynthesisAudio,
  Voice,
} from '@flow-voice/core';
export type { SpeechErrorCode, SpeechError } from '@flow-voice/core';

export type SttEvent =
  | { type: 'partial'; revision: number; text: string }
  | { type: 'final'; mode: 'append' | 'replace'; text: string }
  | { type: 'ended'; reason: 'stopped' | 'cancelled' | 'error' | 'limit' }
  | { type: 'error'; code: SpeechErrorCode; message: string; retryable: boolean };
export interface SttSession {
  /** Resolves true after provider acceptance, false when an audio request is needed (REST).
   * Optional for custom adapters; absence requires an audio probe to verify connectivity. */
  readonly ready?: Promise<boolean>;
  /** Synchronously admit PCM or throw limit_exceeded when the bounded buffer is full.
   * Never drop samples silently. Runner owns admission pacing; adapters cap buffered bytes. */
  write(pcm: Uint8Array): void;
  /** Flush final hypotheses, settle after upstream cleanup. Abort signal cancels instead. */
  end(): Promise<void>;
  /** Single consumer; partial.text replaces the current tentative segment at increasing revision.
   * Final append preserves text verbatim (including provider-owned separators); replace sets the complete committed transcript. */
  readonly events: AsyncIterable<SttEvent>;
}
export interface SttAdapter {
  readonly id: string;
  readonly capabilities: SttCapabilities;
  /** Native live protocol; must release sockets/readers on abort or events iterator return. */
  open(options: { format: PcmInput; language?: string; signal: AbortSignal }): SttSession;
}
export interface AudioChunk {
  audio: Uint8Array;
}
export interface TtsAdapter {
  readonly id: string;
  readonly capabilities: TtsCapabilities;
  /** Return actual output metadata. Own backpressure, safe stream errors and upstream
   * cleanup on signal abort or stream cancellation, including before the first pull. */
  synthesize(
    request: SynthesisRequest & { format?: AudioFormat; signal: AbortSignal },
  ): Promise<SynthesisAudio>;
  listVoices?(signal: AbortSignal): Promise<readonly Voice[]>;
}
export interface SessionLimits {
  maxSessionMs: number;
  maxFrameBytes: number;
  maxBufferedAudioBytes: number;
  finalizationMs: number;
}
export interface LiveTranscriptionSessionOptions {
  adapter: SttAdapter;
  /** Awaited for backpressure. Host must keep authorization valid through terminal delivery. */
  send(message: SttServerMessage): Promise<void>;
  signal: AbortSignal;
  limits?: Partial<SessionLimits>;
}
export interface LiveTranscriptionSession {
  /** Serial admission, bounded audio buffering; resolves when admitted, not when transcription finishes. */
  receive(message: SttClientMessage): Promise<void>;
  cancel(): Promise<void>;
  /** Settles only after terminal delivery and upstream cleanup. */
  readonly done: Promise<void>;
}
export interface SynthesizeOptions extends SynthesisRequest {
  adapter: TtsAdapter;
  format?: AudioFormat;
  signal: AbortSignal;
  maxTextChars?: number;
}
export interface VoiceListOptions {
  adapter: TtsAdapter;
  signal: AbortSignal;
}
export { createLiveTranscriptionSession } from './runner.js';
export { synthesize, listVoices, resolveVoice } from './synthesis.js';
export { createVoiceCatalog } from './catalog.js';
export type { VoiceCatalog } from './catalog.js';
export { createAdapters } from './registry.js';
export type { SpeechTransportOptions, SpeechWebSocket, SpeechWebSocketOptions, SpeechWebSocketEvents } from './transport.js';
export { prepareSpeechEndpoint } from './prepare-endpoint.js';
export type { PrepareSpeechEndpointOptions } from './prepare-endpoint.js';
export { normalizeSpeechError } from './errors.js';
export { synthesisResponse } from './synthesis-http.js';
export { checkSpeechEndpoint } from './check-endpoint.js';
export type { CheckSpeechEndpointOptions, SpeechEndpointCheck } from './check-endpoint.js';
