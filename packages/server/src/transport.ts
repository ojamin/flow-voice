import WebSocket from 'ws';
import { DEFAULT_LIMITS } from '@flow-voice/core';
import type { AudioFormat, ProviderEndpointConfig, SpeechErrorCode, Voice } from '@flow-voice/core';
import { speechError } from './errors.js';

export function createSpeechWebSocket(
  url: URL | string,
  options: WebSocket.ClientOptions,
): WebSocket {
  return new WebSocket(url, { ...options, followRedirects: false });
}

export function authHeaders(apiKey?: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}
/** Append relative paths, preserving a configured API prefix. */
export function endpoint(base: string, path: string): URL {
  return new URL(`${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`);
}
export function linkedAbort(signal: AbortSignal): { controller: AbortController; dispose(): void } {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return { controller, dispose: () => signal.removeEventListener('abort', abort) };
}
/** Single-consumer bounded queue. Overflow fails closed, never drops speech. */
export class BoundedQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiter?: () => void;
  private closed = false;
  private failure?: unknown;
  constructor(
    private readonly capacity = 64,
    private readonly onReturn?: () => void,
  ) {}
  push(value: T): void {
    if (this.closed) return;
    if (this.values.length >= this.capacity) throw speechError('limit_exceeded');
    this.values.push(value);
    this.waiter?.();
  }
  /** Discard queued values only when terminating with a buffer-limit failure. */
  discard(): void {
    this.values.length = 0;
  }
  close(error?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.failure = error;
    this.waiter?.();
  }
  [Symbol.asyncIterator](): AsyncGenerator<T> {
    let returned = false;
    const cleanup = () => {
      if (returned) return;
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
  private async *iterate(cleanup: () => void): AsyncGenerator<T> {
    try {
      while (true) {
        if (this.values.length) {
          yield this.values.shift()!;
          continue;
        }
        if (this.closed) {
          if (this.failure) throw this.failure;
          return;
        }
        await new Promise<void>((resolve) => {
          this.waiter = resolve;
        });
        this.waiter = undefined;
      }
    } finally {
      cleanup();
    }
  }
}
export interface SpeechSocket {
  readonly messages: AsyncIterable<{ data: Uint8Array; binary: boolean }>;
  /** Admits synchronously, throws on full queue. Sends serialized with ws callback backpressure. */
  send(data: string | Uint8Array): void;
  close(): void;
}
/** Buffers only bounded pre-open/outbound frames; protocol handshake belongs to adapter. */
export function openSpeechSocket(options: {
  url: URL | string;
  headers?: Record<string, string>;
  signal: AbortSignal;
  maxBufferedBytes?: number;
  openTimeoutMs?: number;
  keepalive?: { intervalMs: number; message: string };
  acceptClose?(code: number, reason: string): boolean;
  closeError?(code: number, reason: string): SpeechErrorCode;
}): SpeechSocket {
  const ws = createSpeechWebSocket(options.url, {
    headers: options.headers,
    followRedirects: false,
    maxPayload: 1_048_576,
    handshakeTimeout: options.openTimeoutMs ?? 10_000,
  });
  let closed = false;
  let bytes = 0;
  let sending = false;
  const pending: (string | Uint8Array)[] = [];
  const limit = options.maxBufferedBytes ?? DEFAULT_LIMITS.maxBufferedAudioBytes;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    pending.length = 0;
    bytes = 0;
    clearInterval(keepalive);
    options.signal.removeEventListener('abort', abort);
    ws.terminate();
  };
  const messages = new BoundedQueue<{ data: Uint8Array; binary: boolean }>(64, cleanup);
  const fail = (error: unknown) => {
    messages.close(error);
    cleanup();
  };
  const abort = () => fail(speechError('cancelled'));
  const pump = () => {
    if (closed || sending || ws.readyState !== WebSocket.OPEN || !pending.length) return;
    sending = true;
    const data = pending.shift()!;
    ws.send(data, (error) => {
      sending = false;
      bytes -= Buffer.byteLength(data);
      if (error) fail(speechError('transport_error'));
      else pump();
    });
  };
  const send = (data: string | Uint8Array) => {
    if (closed) throw speechError('transport_error');
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
    pump();
    if (options.keepalive)
      keepalive = setInterval(() => {
        try {
          send(options.keepalive!.message);
        } catch (error) {
          fail(error);
        }
      }, options.keepalive.intervalMs);
  });
  ws.on('message', (data, binary) => {
    try {
      messages.push({
        data: new Uint8Array(
          Buffer.isBuffer(data)
            ? data
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : Buffer.concat(data),
        ),
        binary,
      });
    } catch (error) {
      fail(error);
    }
  });
  ws.on('error', () => fail(speechError('transport_error')));
  ws.on('unexpected-response', (_request, response) => {
    response.resume();
    fail(Object.assign(speechError('provider_error'), { status: response.statusCode }));
  });
  ws.on('close', (code, reason) => {
    messages.close(
      closed || options.acceptClose?.(code, reason.toString())
        ? undefined
        : speechError(options.closeError?.(code, reason.toString()) ?? 'transport_error'),
    );
    cleanup();
  });
  if (options.signal.aborted) abort();
  else options.signal.addEventListener('abort', abort, { once: true });
  return {
    messages,
    send,
    close: () => {
      messages.close();
      cleanup();
    },
  };
}
export function jsonFrame(frame: { data: Uint8Array; binary: boolean }): Record<string, unknown> {
  if (frame.binary) throw speechError('provider_error');
  try {
    const value = JSON.parse(Buffer.from(frame.data).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw speechError('provider_error');
  }
}
/** Credentials never cross redirects, including same-origin redirects and HTTPS downgrades. */
export async function checkedFetch(url: URL | string, init: RequestInit): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, redirect: 'error' });
    if (!response.ok) {
      await response.body?.cancel();
      throw speechError(statusCode(response.status));
    }
    return response;
  } catch (error) {
    if (init.signal?.aborted) throw speechError('cancelled');
    if (error instanceof Error && 'code' in error && 'retryable' in error) throw error;
    throw speechError('transport_error');
  }
}
/** Bounded before JSON.parse, not after an unbounded response.json(). */
export async function responseJson(
  response: Response,
  maxBytes = 1_048_576,
): Promise<Record<string, unknown>> {
  const value = await responseJsonValue(response, maxBytes);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw speechError('provider_error');
  return value as Record<string, unknown>;
}
/** Bounded JSON reader for endpoints that also return a top-level array. */
export async function responseJsonValue(response: Response, maxBytes = 1_048_576): Promise<unknown> {
  if (!response.body) throw speechError('provider_error');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) throw speechError('limit_exceeded');
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Incremental body reader. Iterator return cancels fetch body and releases the reader. */
export async function* responseAudio(response: Response): AsyncGenerator<{ audio: Uint8Array }> {
  if (!response.body) throw speechError('provider_error');
  const reader = response.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      if (result.value.length) yield { audio: result.value };
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const MAX_VOICES = 1000;
export const MAX_VOICE_PAGES = 10;
export function nativeError(code: SpeechErrorCode = 'provider_error') {
  return speechError(code);
}
export const nativeFetch = checkedFetch;
export function statusCode(status: number): SpeechErrorCode {
  return status === 401 || status === 403
    ? 'unauthorized'
    : status === 429
      ? 'rate_limited'
      : 'provider_error';
}
export function statusError(status: number) {
  return speechError(statusCode(status));
}
export function nativeUrl(config: ProviderEndpointConfig, fallback: string, path: string): URL {
  try {
    const url = endpoint(config.baseUrl ?? fallback, path);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
    )
      throw new Error();
    return url;
  } catch {
    throw speechError('invalid_message');
  }
}
export function providerUrl(config: ProviderEndpointConfig, path: string, websocket: boolean): URL {
  const url = nativeUrl(config, 'https://api.deepgram.com', path);
  url.protocol = websocket
    ? url.protocol.replace('http', 'ws')
    : url.protocol.replace('ws', 'http');
  return url;
}
export function apiKey(config: ProviderEndpointConfig): string {
  if (!config.apiKey?.trim()) throw speechError('not_configured');
  return config.apiKey;
}
export function normalizeNative(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return nativeError('cancelled');
  return error instanceof Error && 'code' in error && 'retryable' in error ? error : nativeError();
}
export function pcmFormats(rates: readonly number[]): AudioFormat[] {
  return rates.map((sampleRate) => ({
    kind: 'pcm',
    encoding: 'pcm_s16le',
    sampleRate,
    channels: 1,
  }));
}
export function requireVoice(config: ProviderEndpointConfig, voice?: string): string {
  const value = voice ?? config.options?.voice;
  if (typeof value !== 'string' || !value.trim()) throw nativeError('invalid_message');
  return value;
}
export function parseVoices(value: unknown): Voice[] {
  if (!Array.isArray(value) || value.length > MAX_VOICES) throw nativeError();
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw nativeError();
    const v = entry as Record<string, unknown>;
    const id = v.voice_id ?? v.id;
    if (
      typeof id !== 'string' ||
      !id.length ||
      id.length > 256 ||
      typeof v.name !== 'string' ||
      v.name.length > 256 ||
      (typeof v.language === 'string' && v.language.length > 64)
    )
      throw nativeError();
    return {
      id,
      name: v.name,
      ...(typeof v.language === 'string' ? { language: v.language } : {}),
    };
  });
}
