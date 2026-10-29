import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type WebSocket } from 'ws';
/** Test-owned loopback fixture: no external requests, no persistent resources. */
export declare function localServer(options: {
    http?: (request: IncomingMessage, response: ServerResponse) => void;
    ws?: (socket: WebSocket, request: IncomingMessage) => void;
}): Promise<{
    url: string;
    close(): Promise<void>;
}>;
export declare function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>>;
export declare function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
};
import type { TtsAdapter } from './index.js';
/** Drain the public response-bearing API while retaining chunk-level protocol assertions. */
export declare function synthesizeChunks(adapter: TtsAdapter, request: Parameters<TtsAdapter['synthesize']>[0]): AsyncGenerator<{
    audio: Uint8Array<ArrayBufferLike>;
}, void, unknown>;
