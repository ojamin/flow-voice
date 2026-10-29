import type { AudioFormat, ProviderId } from './provider.js';

/** Generic speech options a host may store with an endpoint. */
export interface SpeechEndpointOptions {
  voice?: string;
  speed?: number;
  language?: string;
  sttTransport?: 'realtime' | 'rest';
  format?: AudioFormat;
}
/** An endpoint as typed by an admin. The key is write-only and never read back. */
export interface SpeechEndpointDraft {
  provider: ProviderId;
  model: string;
  baseUrl?: string | null;
  apiKey?: string;
  options?: SpeechEndpointOptions;
}
export type SpeechEndpointWrite = SpeechEndpointDraft | { clear: true };
/** A saved endpoint as a host shows it to a browser: no key, only its hint. */
export interface SpeechEndpointView {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  keyHint: string | null;
  options: SpeechEndpointOptions;
  /** Host policy diagnostic (for example a URL no longer allowed); never set by flow-voice. */
  validationError?: string;
}
export interface SpeechValidationIssue {
  path: readonly string[];
  message: string;
}
export type EndpointValidation =
  | { ok: true; value: SpeechEndpointDraft }
  | { ok: false; issues: readonly SpeechValidationIssue[] };
