import WebSocket from 'ws';
import { DEFAULT_LIMITS, isLocalSpeechEndpoint } from '@flow-voice/core';
import { speechError } from './errors.js';
export function speechTransport(options) {
    return {
        checkedFetch: (url, init) => checkedFetch(url, init, options),
        nativeFetch: (url, init) => checkedFetch(url, init, options),
        createSpeechWebSocket: (url, init) => createSpeechWebSocket(url, init, options),
    };
}
export function createSpeechWebSocket(url, options, transport = {}) {
    const init = { ...options, followRedirects: false };
    return transport.webSocket ? transport.webSocket(url, init) : new WebSocket(url, options.protocols, init);
}
export function authHeaders(apiKey) {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
/** Append relative paths, preserving a configured API prefix. */
export function endpoint(base, path) {
    return new URL(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
}
export function linkedAbort(signal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal.aborted)
        abort();
    else
        signal.addEventListener('abort', abort, { once: true });
    return { controller, dispose: () => signal.removeEventListener('abort', abort) };
}
/** Single-consumer bounded queue. Overflow fails closed, never drops speech. */
export class BoundedQueue {
    capacity;
    onReturn;
    values = [];
    waiter;
    closed = false;
    failure;
    constructor(capacity = 64, onReturn) {
        this.capacity = capacity;
        this.onReturn = onReturn;
    }
    push(value) {
        if (this.closed)
            return;
        if (this.values.length >= this.capacity)
            throw speechError('limit_exceeded');
        this.values.push(value);
        this.waiter?.();
    }
    /** Discard queued values only when terminating with a buffer-limit failure. */
    discard() {
        this.values.length = 0;
    }
    close(error) {
        if (this.closed)
            return;
        this.closed = true;
        this.failure = error;
        this.waiter?.();
    }
    [Symbol.asyncIterator]() {
        let returned = false;
        const cleanup = () => {
            if (returned)
                return;
            returned = true;
            this.close();
            this.values.length = 0;
            this.onReturn?.();
        };
        const source = this.iterate(cleanup);
        const originalReturn = source.return.bind(source);
        source.return = async (value) => {
            cleanup();
            return originalReturn(value);
        };
        return source;
    }
    async *iterate(cleanup) {
        try {
            while (true) {
                if (this.values.length) {
                    yield this.values.shift();
                    continue;
                }
                if (this.closed) {
                    if (this.failure)
                        throw this.failure;
                    return;
                }
                await new Promise((resolve) => {
                    this.waiter = resolve;
                });
                this.waiter = undefined;
            }
        }
        finally {
            cleanup();
        }
    }
}
/** Buffers only bounded pre-open/outbound frames; protocol handshake belongs to adapter. */
export function openSpeechSocket(options) {
    const ws = createSpeechWebSocket(options.url, {
        headers: options.headers,
        followRedirects: false,
        maxPayload: 1_048_576,
        handshakeTimeout: options.openTimeoutMs ?? 10_000,
    }, options.transport);
    let closed = false;
    let bytes = 0;
    let sending = false;
    const pending = [];
    const limit = options.maxBufferedBytes ?? DEFAULT_LIMITS.maxBufferedAudioBytes;
    let keepalive;
    const cleanup = () => {
        if (closed)
            return;
        closed = true;
        pending.length = 0;
        bytes = 0;
        clearInterval(keepalive);
        options.signal.removeEventListener('abort', abort);
        ws.terminate();
    };
    const messages = new BoundedQueue(64, cleanup);
    const fail = (error) => {
        messages.close(error);
        cleanup();
    };
    const abort = () => fail(speechError('cancelled'));
    const pump = () => {
        if (closed || sending || ws.readyState !== WebSocket.OPEN || !pending.length)
            return;
        sending = true;
        const data = pending.shift();
        ws.send(data, (error) => {
            sending = false;
            bytes -= Buffer.byteLength(data);
            if (error)
                fail(speechError('transport_error'));
            else
                pump();
        });
    };
    const send = (data) => {
        if (closed)
            throw speechError('transport_error');
        const size = Buffer.byteLength(data);
        if (bytes + size > limit) {
            fail(speechError('limit_exceeded'));
            throw speechError('limit_exceeded');
        }
        bytes += size;
        pending.push(typeof data === 'string' ? data : data.slice());
        pump();
    };
    ws.on('open', () => {
        options.onOpen?.();
        pump();
        if (options.keepalive)
            keepalive = setInterval(() => {
                try {
                    send(options.keepalive.message);
                }
                catch (error) {
                    fail(error);
                }
            }, options.keepalive.intervalMs);
    });
    ws.on('message', (data, binary) => {
        try {
            messages.push({
                data: new Uint8Array(Buffer.isBuffer(data)
                    ? data
                    : data instanceof ArrayBuffer
                        ? Buffer.from(data)
                        : Buffer.concat(data)),
                binary,
            });
        }
        catch (error) {
            fail(error);
        }
    });
    ws.on('error', () => fail(speechError('transport_error')));
    ws.on('unexpected-response', (_request, response) => {
        response.resume();
        fail(Object.assign(speechError('provider_error'), { status: response.statusCode }));
    });
    ws.on('close', (code, reason) => {
        messages.close(closed || options.acceptClose?.(code, reason.toString())
            ? undefined
            : speechError(options.closeError?.(code, reason.toString()) ?? 'transport_error'));
        cleanup();
    });
    if (options.signal.aborted)
        abort();
    else
        options.signal.addEventListener('abort', abort, { once: true });
    return {
        messages,
        send,
        close: () => {
            messages.close();
            cleanup();
        },
    };
}
export function jsonFrame(frame) {
    if (frame.binary)
        throw speechError('provider_error');
    try {
        const value = JSON.parse(Buffer.from(frame.data).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new Error();
        return value;
    }
    catch {
        throw speechError('provider_error');
    }
}
/** Credentials never cross redirects, including same-origin redirects and HTTPS downgrades. */
export async function checkedFetch(url, init, transport = {}) {
    try {
        const response = await (transport.fetch ?? fetch)(url, { ...init, redirect: 'error' });
        if (!response.ok) {
            await response.body?.cancel();
            throw speechError(statusCode(response.status));
        }
        return response;
    }
    catch (error) {
        if (init.signal?.aborted)
            throw speechError('cancelled');
        if (error instanceof Error && 'code' in error && 'retryable' in error)
            throw error;
        throw speechError('transport_error');
    }
}
/** Bounded before JSON.parse, not after an unbounded response.json(). */
export async function responseJson(response, maxBytes = 1_048_576) {
    const value = await responseJsonValue(response, maxBytes);
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw speechError('provider_error');
    return value;
}
/** Bounded JSON reader for endpoints that also return a top-level array. */
export async function responseJsonValue(response, maxBytes = 1_048_576) {
    if (!response.body)
        throw speechError('provider_error');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            bytes += value.length;
            if (bytes > maxBytes)
                throw speechError('limit_exceeded');
            chunks.push(value);
        }
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        return value;
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
/** Incremental body reader. Iterator return cancels fetch body and releases the reader. */
export async function* responseAudio(response) {
    if (!response.body)
        throw speechError('provider_error');
    const reader = response.body.getReader();
    try {
        while (true) {
            const result = await reader.read();
            if (result.done)
                return;
            if (result.value.length)
                yield { audio: result.value };
        }
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
export const MAX_VOICES = 1000;
export const MAX_VOICE_PAGES = 10;
export function nativeError(code = 'provider_error') {
    return speechError(code);
}
export const nativeFetch = checkedFetch;
export function statusCode(status) {
    return status === 401 || status === 403
        ? 'unauthorized'
        : status === 429
            ? 'rate_limited'
            : 'provider_error';
}
export function statusError(status) {
    return speechError(statusCode(status));
}
export function nativeUrl(config, fallback, path) {
    try {
        const url = endpoint(config.baseUrl ?? fallback, path);
        if (url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol))
            throw new Error();
        return url;
    }
    catch {
        throw speechError('invalid_message');
    }
}
export function providerUrl(config, path, websocket) {
    const url = nativeUrl(config, 'https://api.deepgram.com', path);
    url.protocol = websocket
        ? url.protocol.replace('http', 'ws')
        : url.protocol.replace('ws', 'http');
    return url;
}
export function apiKey(config) {
    if (!config.apiKey?.trim() && isLocalSpeechEndpoint(config.baseUrl))
        return '';
    if (!config.apiKey?.trim())
        throw speechError('not_configured');
    return config.apiKey;
}
export function normalizeNative(error, signal) {
    if (signal.aborted)
        return nativeError('cancelled');
    return error instanceof Error && 'code' in error && 'retryable' in error ? error : nativeError();
}
export function pcmFormats(rates) {
    return rates.map((sampleRate) => ({
        kind: 'pcm',
        encoding: 'pcm_s16le',
        sampleRate,
        channels: 1,
    }));
}
export function requireVoice(config, voice) {
    const value = voice ?? config.options?.voice;
    if (typeof value !== 'string' || !value.trim())
        throw nativeError('invalid_message');
    return value;
}
export function parseVoices(value) {
    if (!Array.isArray(value) || value.length > MAX_VOICES)
        throw nativeError();
    return value.map((entry) => {
        if (!entry || typeof entry !== 'object')
            throw nativeError();
        const v = entry;
        const id = v.voice_id ?? v.id;
        if (typeof id !== 'string' ||
            !id.length ||
            id.length > 256 ||
            typeof v.name !== 'string' ||
            v.name.length > 256 ||
            (typeof v.language === 'string' && v.language.length > 64))
            throw nativeError();
        return {
            id,
            name: v.name,
            ...(typeof v.language === 'string' ? { language: v.language } : {}),
        };
    });
}
//# sourceMappingURL=transport.js.map