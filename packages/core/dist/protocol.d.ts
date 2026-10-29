import { z } from 'zod';
export declare const SPEECH_ERROR_CODES: readonly ['invalid_message', 'not_configured', 'unsupported', 'unauthorized', 'rate_limited', 'limit_exceeded', 'provider_error', 'timeout', 'cancelled', 'transport_error'];
export type SpeechErrorCode = (typeof SPEECH_ERROR_CODES)[number];
export interface SpeechError {
    code: SpeechErrorCode;
    message: string;
}
export declare const pcmInputSchema: z.ZodObject<{
    encoding: z.ZodLiteral<"pcm_s16le">;
    sampleRate: z.ZodUnion<readonly [z.ZodLiteral<8000>, z.ZodLiteral<16000>, z.ZodLiteral<22050>, z.ZodLiteral<24000>, z.ZodLiteral<44100>, z.ZodLiteral<48000>]>;
    channels: z.ZodLiteral<1>;
}, z.core.$strict>;
export type PcmInput = z.infer<typeof pcmInputSchema>;
/** Controls are JSON. Audio travels as raw binary PCM16 little-endian frames, never base64. */
export declare const sttClientControlSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"start">;
    version: z.ZodLiteral<1>;
    audio: z.ZodObject<{
        encoding: z.ZodLiteral<"pcm_s16le">;
        sampleRate: z.ZodUnion<readonly [z.ZodLiteral<8000>, z.ZodLiteral<16000>, z.ZodLiteral<22050>, z.ZodLiteral<24000>, z.ZodLiteral<44100>, z.ZodLiteral<48000>]>;
        channels: z.ZodLiteral<1>;
    }, z.core.$strict>;
    language: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"stop">;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"cancel">;
}, z.core.$strict>], "type">;
export type SttClientControl = z.infer<typeof sttClientControlSchema>;
export interface SttAudioFrame {
    type: 'audio';
    audio: Uint8Array;
}
export type SttClientMessage = SttClientControl | SttAudioFrame;
/** Partial text is a complete replacement at increasing revision, not a delta. committed is stable;
 * tentative may change. final is the complete session transcript; ended is the terminal delivery. */
export declare const sttServerMessageSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"ready">;
    audio: z.ZodObject<{
        encoding: z.ZodLiteral<"pcm_s16le">;
        sampleRate: z.ZodUnion<readonly [z.ZodLiteral<8000>, z.ZodLiteral<16000>, z.ZodLiteral<22050>, z.ZodLiteral<24000>, z.ZodLiteral<44100>, z.ZodLiteral<48000>]>;
        channels: z.ZodLiteral<1>;
    }, z.core.$strict>;
    interim: z.ZodBoolean;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"partial">;
    revision: z.ZodNumber;
    committed: z.ZodString;
    tentative: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"final">;
    revision: z.ZodNumber;
    text: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"ended">;
    reason: z.ZodEnum<{
        cancelled: "cancelled";
        error: "error";
        limit: "limit";
        stopped: "stopped";
    }>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"error">;
    code: z.ZodEnum<{
        cancelled: "cancelled";
        invalid_message: "invalid_message";
        limit_exceeded: "limit_exceeded";
        not_configured: "not_configured";
        provider_error: "provider_error";
        rate_limited: "rate_limited";
        timeout: "timeout";
        transport_error: "transport_error";
        unauthorized: "unauthorized";
        unsupported: "unsupported";
    }>;
    message: z.ZodString;
}, z.core.$strict>], "type">;
export type SttServerMessage = z.infer<typeof sttServerMessageSchema>;
export declare const sttAudioFrameSchema: z.ZodObject<{
    type: z.ZodLiteral<"audio">;
    audio: z.ZodInstanceOf<Uint8Array<ArrayBuffer>>;
}, z.core.$strict>;
export declare const sttClientMessageSchema: z.ZodUnion<readonly [z.ZodDiscriminatedUnion<[z.ZodObject<{
    type: z.ZodLiteral<"start">;
    version: z.ZodLiteral<1>;
    audio: z.ZodObject<{
        encoding: z.ZodLiteral<"pcm_s16le">;
        sampleRate: z.ZodUnion<readonly [z.ZodLiteral<8000>, z.ZodLiteral<16000>, z.ZodLiteral<22050>, z.ZodLiteral<24000>, z.ZodLiteral<44100>, z.ZodLiteral<48000>]>;
        channels: z.ZodLiteral<1>;
    }, z.core.$strict>;
    language: z.ZodOptional<z.ZodString>;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"stop">;
}, z.core.$strict>, z.ZodObject<{
    type: z.ZodLiteral<"cancel">;
}, z.core.$strict>], "type">, z.ZodObject<{
    type: z.ZodLiteral<"audio">;
    audio: z.ZodInstanceOf<Uint8Array<ArrayBuffer>>;
}, z.core.$strict>]>;
/** Throws ZodError/SyntaxError on invalid untrusted input; hosts map to invalid_message. */
export declare function decodeSttClientMessage(raw: unknown): SttClientMessage;
export declare function decodeSttServerMessage(raw: unknown): SttServerMessage;
export declare function encodeSttClientMessage(message: SttClientMessage): string | Uint8Array;
export declare function encodeSttServerMessage(message: SttServerMessage): string;
