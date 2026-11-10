import type { SttEvent, SttSession } from '../index.js';
import type { SpeechTransportOptions } from '../transport.js';
/** Protocol-specific state stays in the adapter; common bounded readiness/finalization lifecycle. */
export declare function websocketStt(options: {
    transport?: SpeechTransportOptions;
    url: URL;
    headers: Record<string, string>;
    signal: AbortSignal;
    start: unknown;
    audio(pcm: Uint8Array): string | Uint8Array;
    stop: unknown;
    emptyEnd?: boolean;
    /** Only before protocol readiness, so no audio has reached the rejected endpoint. */
    fallback?: () => SttSession;
    parse(event: Record<string, unknown>): {
        ready?: boolean;
        events?: SttEvent[];
        done?: boolean;
    };
}): SttSession;
