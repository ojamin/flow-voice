import type { SpeechEndpointDraft, SpeechKind } from '@flow-voice/core';
import { createAdapters } from './registry.js';
import type { SpeechTransportOptions } from './transport.js';
export interface PrepareSpeechEndpointOptions extends SpeechTransportOptions {
    kind: SpeechKind;
    draft: SpeechEndpointDraft;
    apiKey?: string;
    createAdapters?: typeof createAdapters;
}
/** Host authorizes, binds credentials and applies URL policy before calling this. */
export declare function prepareSpeechEndpoint(options: PrepareSpeechEndpointOptions): ReturnType<typeof createAdapters>;
