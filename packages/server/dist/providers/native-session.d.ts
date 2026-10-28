import type { SpeechErrorCode } from '@flow-voice/core';
import type { SttEvent, SttSession } from '../index.js';
/** Native framing/readiness for Deepgram and AssemblyAI; transport owns socket lifecycle. */
export declare function nativeSession(options: {
    url: URL;
    authorization: string;
    signal: AbortSignal;
    endMessage: string;
    keepAliveMs?: number;
    chunkBytes?: number;
    minChunkBytes?: number;
    startMessage?: string;
    waitForTermination?: boolean;
    closeCode?(code: number, reason: string): SpeechErrorCode;
    message(value: Record<string, unknown>, emit: (event: SttEvent) => void, complete: () => void): void;
}): SttSession;
