import type { AudioFormat, ProviderId } from './provider.js';
import { z } from 'zod';
export declare const speechEndpointOptionsSchema: z.ZodObject<{
    voice: z.ZodOptional<z.ZodString>;
    speed: z.ZodOptional<z.ZodNumber>;
    language: z.ZodOptional<z.ZodString>;
    sttTransport: z.ZodOptional<z.ZodEnum<{
        realtime: "realtime";
        rest: "rest";
    }>>;
    format: z.ZodOptional<z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"pcm">;
        encoding: z.ZodLiteral<"pcm_s16le">;
        sampleRate: z.ZodNumber;
        channels: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"encoded">;
        mimeType: z.ZodString;
    }, z.core.$strict>], "kind">>;
}, z.core.$strict>;
/** Syntax and key binding only; hosts still authorize and apply their URL policy. */
export declare function validateSpeechEndpointDraft(value: unknown, previous?: Pick<SpeechEndpointView, 'provider' | 'baseUrl'> | null): EndpointValidation;
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
export type SpeechEndpointWrite = SpeechEndpointDraft | {
    clear: true;
};
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
export type EndpointValidation = {
    ok: true;
    value: SpeechEndpointDraft;
} | {
    ok: false;
    issues: readonly SpeechValidationIssue[];
};
