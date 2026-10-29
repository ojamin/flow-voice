import type {
  AudioFormat,
  PcmInput,
  SpeechError,
  SpeechSection,
  SttClientMessage,
  SttServerMessage,
  SynthesisAudio,
  SynthesisRequest,
} from '@flow-voice/core';
import type { PlaybackGate } from './player/gate.js';
export { createCallSession } from './call-session.js';
export type { CallSession, CallSessionOptions, CallSessionSnapshot, CallMediaSession, CallMediaAction } from './call-session.js';
export { createVoiceMode } from './voice-mode.js';
export type { VoiceMode, VoiceModeSnapshot, VoiceScope } from './voice-mode.js';
export interface ExternalStore<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}
export interface AudioCaptureOptions {
  format: PcmInput;
  onFrame(audio: Uint8Array, rms: number): void;
  onError(error: SpeechError): void;
  signal: AbortSignal;
  /** Same-origin module asset URL; see the browser integration guide. */
  workletUrl?: string | URL;
  /** Opt-in fallback only for hosts whose script-src explicitly allows blob:. */
  inlineWorklet?: { source: string; cspAllowsBlob: true };
}
export interface AudioCapture {
  start(): Promise<void>;
  stop(): Promise<void>;
}
export { createAudioCapture } from './capture/capture.js';
export { PcmResampler } from './capture/resampler.js';
/** Hosts provide authenticated transport. A send promise applies backpressure, never silent dropping. */
export interface DictationTransport {
  connect(options: {
    onMessage(message: SttServerMessage): void;
    onError(error: SpeechError): void;
    signal: AbortSignal;
  }): Promise<void>;
  send(message: SttClientMessage): Promise<void>;
  close(): void;
}
export { createWebSocketDictationTransport } from './transport/websocket.js';
export interface SubmissionBinding {
  /** Wait for final transcription before normal submit reads its draft. */
  finish(): Promise<void>;
  /** Normal submit completed; detach dictation's draft ownership. */
  release(): void;
  /** Submit failed: retain the finalized draft and surface a stopped/error state. */
  failed?(): void;
  /** Draft replaced/navigation occurred: stop without overwriting the new draft. */
  invalidate(): void;
}
/** Composer owns selection/draft transaction safety. No synthetic Enter or direct HTTP sends. */
export interface ComposerAdapter {
  /** Capture selection and original draft, establishing ownership of a single insertion. */
  begin(): void;
  /** Complete replacement hypothesis for that insertion, not append. Retain committed on failure. */
  update(transcript: { committed: string; tentative: string }): void;
  finish(text: string): void;
  /** Cancel tentative content only, retain already committed words. */
  cancel(): void;
  canSubmit(): boolean;
  submit(): Promise<void>;
  bindSubmission(binding: SubmissionBinding): () => void;
  /** Native input/keydown activity, not programmatic transcript updates. */
  subscribeUserActivity?(listener: () => void): () => void;
}
export interface DictationSnapshot {
  status: 'idle' | 'connecting' | 'listening' | 'finalizing' | 'error';
  committed: string;
  tentative: string;
  rms: number;
  countdownMs: number | null;
  error: SpeechError | null;
}
export interface DictationController extends ExternalStore<DictationSnapshot> {
  start(): Promise<void>;
  finish(): Promise<void>;
  cancel(): Promise<void>;
  cancelAutoSend(): void;
  /** Hosts without subscribeUserActivity must call this on input/keypress. */
  notifyUserActivity(): void;
  dispose(): Promise<void>;
}
export interface DictationControllerOptions {
  transport: DictationTransport;
  composer: ComposerAdapter;
  audio: PcmInput;
  capture?(options: AudioCaptureOptions): AudioCapture;
  /** `afterPause: false` sends only on `keyword`, with no silence countdown. */
  autoSend?: { enabled: boolean; silenceMs: number; keyword?: string; afterPause?: boolean };
  /** Defaults to true (stop after Send). False starts a fresh session after successful submission. */
  stopAfterSend?: boolean;
  language?: string;
  /** Optional: host synchronously stops playback before microphone acquisition (half duplex).
   * Without it, capture and playback run together; capture asks for echo cancellation. */
  beforeCapture?(): void;
  playbackGate?: { stop(): void | Promise<void>; isPlaying(): boolean };
  workletUrl?: string | URL;
  maxSessionMs?: number;
  finalizationMs?: number;
  connectionTimeoutMs?: number;
}
export { createDictationController } from './dictation/controller.js';
export { createTextareaComposerAdapter } from './dictation/textarea.js';
export type SynthesisFetcher = (
  request: SynthesisRequest & { signal: AbortSignal },
) => Promise<SynthesisAudio>;
export interface SpeechMessage {
  /** False while more sections may arrive; completion releases live ownership. */
  complete?: boolean;
  id: string;
  sections: readonly SpeechSection[];
  voice?: string;
  speed?: number;
  language?: string;
}
export interface SpeechPlayerSnapshot {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'blocked' | 'error';
  messageId: string | null;
  sectionOrdinal: number | null;
  queuedMessages: number;
  error: SpeechError | null;
}
export interface SpeechPlayer extends ExternalStore<SpeechPlayerSnapshot> {
  unlock(): Promise<void>;
  enqueue(message: SpeechMessage): void;
  /** Append new sections to an already queued/playing message without replaying old ordinals. */
  append(message: SpeechMessage): void;
  pause(): void;
  resume(): Promise<void>;
  skipSection(): void;
  /** End current message and continue next queued message. */
  skipToEnd(): void;
  /** Clear queue and invalidate all in-flight synthesis/sections. */
  stop(): void;
  /** Route PCM playback through one continuously playing media element, so mobile browsers
   * keep the page running with the screen off or another app in front (like a call) and show
   * media controls. Call inside a user gesture to enable. */
  setBackgroundAudio(enabled: boolean): Promise<void>;
  dispose(): void;
}
export interface SpeechPlayerOptions {
  synthesize: SynthesisFetcher;
  maxQueuedSections?: number;
  beforePlay?(): Promise<void> | void;
  gate?: PlaybackGate;
}
export { createSpeechPlayer } from './player/player.js';
export { createPlaybackGate } from './player/gate.js';
export type { PlaybackGate } from './player/gate.js';
export interface ReadableMessage {
  id: string;
  markdown: string;
  agentName?: string;
  own: boolean;
  complete: boolean;
}
export interface MessageArrival {
  message: ReadableMessage;
  source: 'live' | 'history' | 'replay';
}
/** Snapshot establishes the no-history watermark. Subscribe emits arrivals AND growing-message updates. */
export interface MessageAdapter {
  getSnapshot(): readonly ReadableMessage[];
  subscribe(listener: (arrival: MessageArrival) => void): () => void;
}
export interface AgentVoicePreference {
  voice?: string;
  speed?: number;
  muted?: boolean;
}
export interface AutoReaderOptions {
  player: SpeechPlayer;
  messages: MessageAdapter;
  enabled: boolean;
  routeIdentity?: unknown;
  filter?(message: ReadableMessage): boolean;
  preferences?(agentName?: string): AgentVoicePreference;
}
export interface AutoReader {
  setEnabled(enabled: boolean): void;
  setRouteIdentity(identity: unknown): void;
  dispose(): void;
}
export { createAutoReader } from './auto-read/reader.js';
export type { AudioFormat };
