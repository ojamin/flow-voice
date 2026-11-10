import type { ClientRequest, IncomingMessage } from 'node:http';
import type { AudioFormat, ProviderEndpointConfig, SpeechErrorCode, Voice } from '@flow-voice/core';
/** Node event-emitter contract; a ws instance satisfies it without a wrapper. */
export interface SpeechWebSocketEvents {
    open: [];
    message: [data: Buffer | ArrayBuffer | Buffer[], binary: boolean];
    error: [error: Error];
    close: [code: number, reason: Buffer];
    'unexpected-response': [request: ClientRequest, response: IncomingMessage];
}
export interface SpeechWebSocket {
    readonly readyState: number;
    readonly bufferedAmount: number;
    on<E extends keyof SpeechWebSocketEvents>(event: E, listener: (...args: SpeechWebSocketEvents[E]) => void): unknown;
    send(data: string | Uint8Array, callback?: (error?: Error) => void): void;
    close(): void;
    terminate(): void;
}
export interface SpeechWebSocketOptions {
    headers?: Record<string, string>;
    protocols?: string | string[];
    followRedirects?: false;
    maxPayload?: number;
    handshakeTimeout?: number;
}
export interface SpeechTransportOptions {
    fetch?: typeof fetch;
    /** Node ws-compatible socket factory. Redirects must remain disabled. */
    webSocket?: (url: URL | string, options: SpeechWebSocketOptions) => SpeechWebSocket;
}
export declare function speechTransport(options: SpeechTransportOptions): {
    checkedFetch: (url: URL | string, init: RequestInit) => Promise<Response>;
    nativeFetch: (url: URL | string, init: RequestInit) => Promise<Response>;
    createSpeechWebSocket: (url: URL | string, init: SpeechWebSocketOptions) => SpeechWebSocket;
};
export declare function createSpeechWebSocket(url: URL | string, options: SpeechWebSocketOptions, transport?: SpeechTransportOptions): SpeechWebSocket;
export declare function authHeaders(apiKey?: string): Record<string, string>;
/** Append relative paths, preserving a configured API prefix. */
export declare function endpoint(base: string, path: string): URL;
export declare function linkedAbort(signal: AbortSignal): {
    controller: AbortController;
    dispose(): void;
};
/** Single-consumer bounded queue. Overflow fails closed, never drops speech. */
export declare class BoundedQueue<T> implements AsyncIterable<T> {
    private readonly capacity;
    private readonly onReturn?;
    private values;
    private waiter?;
    private closed;
    private failure?;
    constructor(capacity?: number, onReturn?: (() => void) | undefined);
    push(value: T): void;
    /** Discard queued values only when terminating with a buffer-limit failure. */
    discard(): void;
    close(error?: unknown): void;
    [Symbol.asyncIterator](): AsyncGenerator<T>;
    private iterate;
}
export interface SpeechSocket {
    readonly messages: AsyncIterable<{
        data: Uint8Array;
        binary: boolean;
    }>;
    /** Admits synchronously, throws on full queue. Sends serialized with ws callback backpressure. */
    send(data: string | Uint8Array): void;
    close(): void;
}
/** Buffers only bounded pre-open/outbound frames; protocol handshake belongs to adapter. */
export declare function openSpeechSocket(options: {
    transport?: SpeechTransportOptions;
    url: URL | string;
    headers?: Record<string, string>;
    signal: AbortSignal;
    maxBufferedBytes?: number;
    openTimeoutMs?: number;
    keepalive?: {
        intervalMs: number;
        message: string;
    };
    onOpen?(): void;
    acceptClose?(code: number, reason: string): boolean;
    closeError?(code: number, reason: string): SpeechErrorCode;
}): SpeechSocket;
export declare function jsonFrame(frame: {
    data: Uint8Array;
    binary: boolean;
}): Record<string, unknown>;
/** Credentials never cross redirects, including same-origin redirects and HTTPS downgrades. */
export declare function checkedFetch(url: URL | string, init: RequestInit, transport?: SpeechTransportOptions): Promise<Response>;
/** Bounded before JSON.parse, not after an unbounded response.json(). */
export declare function responseJson(response: Response, maxBytes?: number): Promise<Record<string, unknown>>;
/** Bounded JSON reader for endpoints that also return a top-level array. */
export declare function responseJsonValue(response: Response, maxBytes?: number): Promise<unknown>;
/** Incremental body reader. Iterator return cancels fetch body and releases the reader. */
export declare function responseAudio(response: Response): AsyncGenerator<{
    audio: Uint8Array;
}>;
export declare const MAX_VOICES = 1000;
export declare const MAX_VOICE_PAGES = 10;
export declare function nativeError(code?: SpeechErrorCode): Error & import("@flow-voice/core").SpeechError & {
    retryable: boolean;
};
export declare const nativeFetch: typeof checkedFetch;
export declare function statusCode(status: number): SpeechErrorCode;
export declare function statusError(status: number): Error & import("@flow-voice/core").SpeechError & {
    retryable: boolean;
};
export declare function nativeUrl(config: ProviderEndpointConfig, fallback: string, path: string): URL;
export declare function providerUrl(config: ProviderEndpointConfig, path: string, websocket: boolean): URL;
export declare function apiKey(config: ProviderEndpointConfig): string;
export declare function normalizeNative(error: unknown, signal: AbortSignal): Error;
export declare function pcmFormats(rates: readonly number[]): AudioFormat[];
export declare function requireVoice(config: ProviderEndpointConfig, voice?: string): string;
export declare function parseVoices(value: unknown): Voice[];
