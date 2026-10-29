import type { SttSession } from '../index.js';
export declare function restTranscription(options: {
    url: URL;
    headers: Record<string, string>;
    model: string;
    language?: string;
    rate: number;
    signal: AbortSignal;
    timeoutMs: number;
}): SttSession;
