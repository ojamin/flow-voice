import { z } from 'zod';
import { DEFAULT_LIMITS } from './provider.js';

export const SPEECH_ERROR_CODES = [
  'invalid_message',
  'not_configured',
  'unsupported',
  'unauthorized',
  'rate_limited',
  'limit_exceeded',
  'provider_error',
  'timeout',
  'cancelled',
  'transport_error',
] as const;
export type SpeechErrorCode = (typeof SPEECH_ERROR_CODES)[number];
export interface SpeechError {
  code: SpeechErrorCode;
  message: string;
}
export const pcmInputSchema = z.strictObject({
  encoding: z.literal('pcm_s16le'),
  sampleRate: z.union([
    z.literal(8000),
    z.literal(16000),
    z.literal(22050),
    z.literal(24000),
    z.literal(44100),
    z.literal(48000),
  ]),
  channels: z.literal(1),
});
export type PcmInput = z.infer<typeof pcmInputSchema>;
/** Controls are JSON. Audio travels as raw binary PCM16 little-endian frames, never base64. */
export const sttClientControlSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('start'),
    version: z.literal(1),
    audio: pcmInputSchema,
    language: z.string().trim().min(1).max(64).optional(),
  }),
  z.strictObject({ type: z.literal('stop') }),
  z.strictObject({ type: z.literal('cancel') }),
]);
export type SttClientControl = z.infer<typeof sttClientControlSchema>;
export interface SttAudioFrame {
  type: 'audio';
  audio: Uint8Array;
}
export type SttClientMessage = SttClientControl | SttAudioFrame;
/** Partial text is a complete replacement at increasing revision, not a delta. committed is stable;
 * tentative may change. final is the complete session transcript; ended is the terminal delivery. */
export const sttServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready'), audio: pcmInputSchema, interim: z.boolean() }),
  z.strictObject({
    type: z.literal('partial'),
    revision: z.number().int().nonnegative(),
    committed: z.string().max(32_000),
    tentative: z.string().max(32_000),
  }),
  z.strictObject({
    type: z.literal('final'),
    revision: z.number().int().nonnegative(),
    text: z.string().max(32_000),
  }),
  z.strictObject({
    type: z.literal('ended'),
    reason: z.enum(['stopped', 'cancelled', 'error', 'limit']),
  }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(SPEECH_ERROR_CODES),
    message: z.string().max(512),
  }),
]);
export type SttServerMessage = z.infer<typeof sttServerMessageSchema>;
export const sttAudioFrameSchema = z.strictObject({
  type: z.literal('audio'),
  audio: z
    .instanceof(Uint8Array)
    .refine(
      (audio) =>
        audio.byteLength > 0 &&
        audio.byteLength % 2 === 0 &&
        audio.byteLength <= DEFAULT_LIMITS.maxFrameBytes,
      'Expected bounded, nonempty PCM16 samples',
    ),
});
export const sttClientMessageSchema = z.union([sttClientControlSchema, sttAudioFrameSchema]);
/** Throws ZodError/SyntaxError on invalid untrusted input; hosts map to invalid_message. */
export function decodeSttClientMessage(raw: unknown): SttClientMessage {
  if (raw instanceof ArrayBuffer) raw = new Uint8Array(raw);
  if (raw instanceof Uint8Array) return sttAudioFrameSchema.parse({ type: 'audio', audio: raw });
  if (typeof raw === 'string') {
    if (raw.length > 4096) throw new RangeError('Control frame too large');
    raw = JSON.parse(raw);
  }
  return sttClientMessageSchema.parse(raw);
}
export function decodeSttServerMessage(raw: unknown): SttServerMessage {
  if (typeof raw === 'string') {
    if (raw.length > 128_000) throw new RangeError('Transcript frame too large');
    raw = JSON.parse(raw);
  }
  return sttServerMessageSchema.parse(raw);
}
export function encodeSttClientMessage(message: SttClientMessage): string | Uint8Array {
  const parsed = sttClientMessageSchema.parse(message);
  return parsed.type === 'audio' ? parsed.audio : JSON.stringify(parsed);
}
export function encodeSttServerMessage(message: SttServerMessage): string {
  return JSON.stringify(sttServerMessageSchema.parse(message));
}
