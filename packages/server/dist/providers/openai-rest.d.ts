import type { SttSession } from '../index.js';
import type { SpeechTransportOptions } from '../transport.js';
export declare function restTranscription(options: {
    transport?: SpeechTransportOptions;
    url: URL;
    headers: Record<string, string>;
    model: string;
    language?: string;
    rate: number;
    signal: AbortSignal;
    timeoutMs: number;
}): SttSession;
