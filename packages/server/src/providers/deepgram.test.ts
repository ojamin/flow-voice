import { synthesizeChunks } from '../test-servers.js';
import type { SpeechErrorCode } from '@flow-voice/core';
import { speechError, normalizeSpeechError } from '../errors.js';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeepgramAdapters } from './deepgram.js';
import { localServer } from '../test-servers.js';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const format = { encoding: 'pcm_s16le' as const, sampleRate: 16000 as const, channels: 1 as const };
describe('Deepgram voice catalog', () => {
  it('reads live TTS metadata, marks only the configured default and preserves prefixes/auth', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      stt: [{ canonical_name: 'nova-3' }],
      tts: [
        { name: 'thalia', canonical_name: 'aura-2-thalia-en', architecture: 'aura-2', languages: ['en', 'en-US'] },
        { name: 'luna', canonical_name: 'aura-2-luna-en', architecture: 'aura-2', languages: ['en'] },
        { name: 'luna', canonical_name: 'aura-2-luna-en', architecture: 'aura-2', languages: ['en'] },
      ],
    }));
    const { tts } = createDeepgramAdapters({ provider: 'deepgram', model: 'aura-2-luna-en', apiKey: 'secret', baseUrl: 'https://speech.example/prefix' });
    expect(tts.capabilities.voices).toBe('list');
    expect(await tts.listVoices!(new AbortController().signal)).toEqual([
      { id: 'aura-2-thalia-en', name: 'Thalia (aura-2, en)', language: 'en' },
      { id: 'aura-2-luna-en', name: 'Luna (aura-2, en)', language: 'en', isDefault: true },
      { id: 'aura-2-luna-en', name: 'Luna (aura-2, en)', language: 'en' },
    ]);
    expect(String(fetch.mock.calls[0]![0])).toBe('https://speech.example/prefix/v1/models');
    expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Token secret' }, redirect: 'error', signal: expect.any(AbortSignal) });
  });
  it.each([
    ['aura-2-luna-en', undefined, 'aura-2-luna-en'],
    ['aura-2-luna-en', 'aura-2-thalia-en', 'aura-2-thalia-en'],
    ['nova-3', undefined, 'aura-2-thalia-en'],
    ['', undefined, 'aura-2-thalia-en'],
  ])('synthesis selects configured/requested voice (%s, %s)', async (model, voice, expected) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2])));
    const { tts } = createDeepgramAdapters({ provider: 'deepgram', model: model!, apiKey: 'secret' });
    await collect(synthesizeChunks(tts, { text: 'hi', voice, format: { kind: 'pcm', ...format }, signal: new AbortController().signal }));
    expect(new URL(fetch.mock.calls[0]![0].toString()).searchParams.get('model')).toBe(expected);
  });
  it.each([401, 403, 500])('throws normalized catalog errors for HTTP %s rather than returning suggestions', async (status) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status }));
    const { tts } = createDeepgramAdapters({ provider: 'deepgram', model: '', apiKey: 'secret' });
    await expect(tts.listVoices!(new AbortController().signal)).rejects.toMatchObject({ code: status === 500 ? 'provider_error' : 'unauthorized' });
  });
  it('rejects excessive catalogs and malformed entries', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { tts } = createDeepgramAdapters({ provider: 'deepgram', model: '', apiKey: 'secret' });
    fetch.mockResolvedValueOnce(Response.json({ tts: Array.from({ length: 1001 }, () => ({})) }));
    await expect(tts.listVoices!(new AbortController().signal)).rejects.toMatchObject({ code: 'limit_exceeded' });
    fetch.mockResolvedValueOnce(Response.json({ tts: [{ name: 'missing canonical name' }] }));
    await expect(tts.listVoices!(new AbortController().signal)).rejects.toMatchObject({ code: 'provider_error' });
  });
});
async function wsFixture() {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  cleanups.push(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const connected = once(server, 'connection');
  const controller = new AbortController();
  const adapters = createDeepgramAdapters({
    provider: 'deepgram',
    model: 'nova-3',
    apiKey: 'test-secret',
    baseUrl,
  });
  const session = adapters.stt.open({ format, language: 'fr', signal: controller.signal });
  const [socket, request] = await connected;
  return { socket, request, session, controller, adapters };
}
function result(text: string, final = false, speechFinal = false) {
  return JSON.stringify({
    type: 'Results',
    channel: { alternatives: [{ transcript: text }] },
    is_final: final,
    speech_final: speechFinal,
  });
}

describe('Deepgram live native protocol', () => {
  it('authenticates, sends PCM, exposes revisions before end and flushes every final segment once', async () => {
    const { socket, request, session } = await wsFixture();
    const url = new URL(request.url, 'http://local');
    expect(url.pathname).toBe('/v1/listen');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      model: 'nova-3',
      language: 'fr',
      endpointing: '25',
      utterance_end_ms: '1000',
    });
    expect(request.headers.authorization).toBe('Token test-secret');
    const received = once(socket, 'message');
    session.write(new Uint8Array([1, 2, 3, 4]));
    const [pcm, binary] = await received;
    expect(binary).toBe(true);
    expect([...pcm]).toEqual([1, 2, 3, 4]);
    const events = session.events[Symbol.asyncIterator]();
    socket.send(result('bon'));
    expect(await events.next()).toEqual({
      done: false,
      value: { type: 'partial', revision: 1, text: 'bon' },
    });
    socket.send(result('bonjour', true));
    expect((await events.next()).value).toEqual({ type: 'final', mode: 'append', text: 'bonjour' });
    socket.send(JSON.stringify({ type: 'UtteranceEnd', last_word_end: 1 }));
    socket.send(result('mon'));
    expect((await events.next()).value).toEqual({ type: 'partial', revision: 2, text: 'mon' });
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        expect(JSON.parse(data.toString())).toEqual({ type: 'CloseStream' });
        socket.send(result('monde', true, true));
        socket.send(result('', true, true));
        socket.send(JSON.stringify({ type: 'Metadata' }));
        socket.close(1000);
      }
    });
    const ending = session.end();
    expect((await events.next()).value).toEqual({ type: 'final', mode: 'append', text: ' monde' });
    expect((await events.next()).value).toEqual({ type: 'ended', reason: 'stopped' });
    await ending;
    expect((await events.next()).done).toBe(true);
    expect(() => session.write(new Uint8Array([0, 0]))).toThrow();
  });

  it('sends text KeepAlive controls and stops the heartbeat on cancellation', async () => {
    const { socket, session, controller } = await wsFixture();
    // Observe the real text heartbeat over local IO at the documented 4s interval.
    const [data, binary] = await once(socket, 'message');
    expect(binary).toBe(false);
    expect(JSON.parse(data.toString())).toEqual({ type: 'KeepAlive' });
    const closed = once(socket, 'close');
    controller.abort();
    await session.end();
    await closed;
    expect(await collect(session.events)).toEqual([{ type: 'ended', reason: 'cancelled' }]);
  }, 6000);

  it('cancels when the consumer returns and discards pending speech', async () => {
    const { socket, session } = await wsFixture();
    const closed = once(socket, 'close');
    const events = session.events[Symbol.asyncIterator]();
    await events.return?.();
    await closed;
    await session.end();
  });

  it('bounds pre-open admission without dropping samples', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    cleanups.push(async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const controller = new AbortController();
    const { stt } = createDeepgramAdapters({
      provider: 'deepgram',
      model: 'nova-3',
      apiKey: 'key',
      baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const session = stt.open({ format, signal: controller.signal });
    for (let i = 0; i < 10; i++) session.write(new Uint8Array(32000));
    expect(() => session.write(new Uint8Array(2))).toThrow(
      expect.objectContaining({ code: 'limit_exceeded' }),
    );
    controller.abort();
    await session.end();
  });

  it('normalizes malformed responses, never exposing upstream text', async () => {
    const { socket, session } = await wsFixture();
    socket.send('{test-secret: bad');
    expect(await collect(session.events)).toEqual([
      {
        type: 'error',
        ...normalizeSpeechError(speechError('provider_error')),
      },
      { type: 'ended', reason: 'error' },
    ]);
  });

  it('bounds output when no consumer drains provider messages', async () => {
    const { socket, session } = await wsFixture();
    const closed = once(socket, 'close');
    for (let i = 0; i < 130; i++) socket.send(result('word'));
    await closed;
    expect(await collect(session.events)).toEqual([
      {
        type: 'error',
        ...normalizeSpeechError(speechError('limit_exceeded')),
      },
      { type: 'ended', reason: 'error' },
    ]);
  });

  it('flushes audio admitted before connect, then sends CloseStream in order', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(server, 'listening');
    cleanups.push(async () => {
      for (const client of server.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const messages: { data: Buffer; binary: boolean }[] = [];
    server.on('connection', (socket) =>
      socket.on('message', (data: Buffer, binary: boolean) => {
        messages.push({ data, binary });
        if (!binary) {
          socket.send(result('flushed', true, true));
          socket.close(1000);
        }
      }),
    );
    const { stt } = createDeepgramAdapters({
      provider: 'deepgram',
      model: 'nova-3',
      apiKey: 'key',
      baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const session = stt.open({ format, signal: new AbortController().signal });
    const pcm = new Uint8Array([1, 2]);
    session.write(pcm);
    pcm.fill(9); // queued admission owns its copy
    await session.end();
    expect(messages.map((message) => message.binary)).toEqual([true, false]);
    expect([...messages[0]!.data]).toEqual([1, 2]);
    expect(JSON.parse(messages[1]!.data.toString())).toEqual({ type: 'CloseStream' });
    expect(await collect(session.events)).toEqual([
      { type: 'final', mode: 'append', text: 'flushed' },
      { type: 'ended', reason: 'stopped' },
    ]);
  });

  it.each([
    [401, 'unauthorized'],
    [429, 'rate_limited'],
  ])('normalizes HTTP upgrade failure %s', async (status, code) => {
    const server = createServer((_request, response) => {
      response.writeHead(status);
      response.end('private secret');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    const { stt } = createDeepgramAdapters({
      provider: 'deepgram',
      model: 'nova-3',
      apiKey: 'key',
      baseUrl: `ws://127.0.0.1:${(server.address() as AddressInfo).port}`,
    });
    const session = stt.open({ format, signal: new AbortController().signal });
    expect(await collect(session.events)).toEqual([
      {
        type: 'error',
        code,
        message: speechError(code as SpeechErrorCode).message,
        retryable: status === 429,
      },
      { type: 'ended', reason: 'error' },
    ]);
  });

  it('never connects when already cancelled and sanitizes invalid endpoint errors', async () => {
    const { stt } = createDeepgramAdapters({
      provider: 'deepgram',
      model: 'nova-3',
      apiKey: 'key',
    });
    const session = stt.open({ format, signal: AbortSignal.abort() });
    expect(await collect(session.events)).toEqual([{ type: 'ended', reason: 'cancelled' }]);
    await session.end();
    const invalid = createDeepgramAdapters({
      provider: 'deepgram',
      model: 'nova-3',
      apiKey: 'key',
      baseUrl: 'private-invalid-url',
    }).stt;
    expect(() => invalid.open({ format, signal: new AbortController().signal })).toThrow(
      expect.objectContaining({
        code: 'invalid_message',
        message: speechError('invalid_message').message,
      }),
    );
  });

  it('times out a provider that never finishes CloseStream', async () => {
    const { session } = await wsFixture();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const ending = session.end();
    await vi.advanceTimersByTimeAsync(10000);
    await ending;
    expect(await collect(session.events)).toEqual([
      {
        type: 'error',
        ...normalizeSpeechError(speechError('timeout')),
      },
      { type: 'ended', reason: 'error' },
    ]);
  });
});

async function httpFixture(handler: RequestListener) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return createDeepgramAdapters({
    provider: 'deepgram',
    model: 'aura-2-thalia-en',
    apiKey: 'secret',
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  }).tts;
}
const pcmFormat = {
  kind: 'pcm' as const,
  encoding: 'pcm_s16le' as const,
  sampleRate: 24000,
  channels: 1 as const,
};

describe('Deepgram Aura streaming HTTP', () => {
  it('yields audio before response end and cancels the request on iterator return', async () => {
    let requestClosed!: Promise<unknown>;
    const tts = await httpFixture(async (request, response) => {
      const url = new URL(request.url!, 'http://local');
      expect(request.method).toBe('POST');
      expect(request.headers.authorization).toBe('Token secret');
      expect(request.headers['content-type']).toBe('application/json');
      expect(url.pathname).toBe('/v1/speak');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        model: 'aura-2-apollo-en',
        speed: '1.1',
        encoding: 'linear16',
        container: 'none',
        sample_rate: '24000',
      });
      let body = '';
      for await (const chunk of request) body += chunk;
      expect(JSON.parse(body)).toEqual({ text: 'hello' });
      requestClosed = once(response, 'close');
      response.writeHead(200, { 'Content-Type': 'audio/l16' });
      response.write(Buffer.from([1, 2, 3, 4])); // deliberately never end
    });
    const audio = synthesizeChunks(tts, {
        text: 'hello',
        voice: 'aura-2-apollo-en',
        speed: 1.1,
        format: pcmFormat,
        signal: new AbortController().signal,
      })
      [Symbol.asyncIterator]();
    expect((await audio.next()).value).toEqual({ audio: new Uint8Array([1, 2, 3, 4]) });
    await audio.return?.();
    await requestClosed;
  });

  it.each([
    ['audio/mpeg', { encoding: 'mp3' }],
    ['audio/ogg;codecs=opus', { encoding: 'opus', container: 'ogg' }],
  ])(
    'uses native encoded format %s without PCM sample-rate parameters',
    async (mimeType, params) => {
      const tts = await httpFixture((request, response) => {
        expect(Object.fromEntries(new URL(request.url!, 'http://local').searchParams)).toEqual({
          model: 'aura-2-thalia-en',
          ...params,
        });
        response.end(Buffer.from([5, 6]));
      });
      expect(
        await collect(
          synthesizeChunks(tts, {
            text: 'hello',
            format: { kind: 'encoded', mimeType },
            signal: new AbortController().signal,
          }),
        ),
      ).toEqual([{ audio: new Uint8Array([5, 6]) }]);
    },
  );

  it.each([
    [401, 'unauthorized'],
    [429, 'rate_limited'],
    [500, 'provider_error'],
  ])('redacts HTTP %s errors', async (status, code) => {
    const tts = await httpFixture((_request, response) => {
      response.writeHead(status);
      response.end('secret provider diagnostic');
    });
    await expect(
      collect(
        synthesizeChunks(tts, { text: 'hi', format: pcmFormat, signal: new AbortController().signal }),
      ),
    ).rejects.toMatchObject({ code, message: speechError(code as SpeechErrorCode).message });
  });

  it('aborts an active response reader', async () => {
    let requestClosed!: Promise<unknown>;
    const tts = await httpFixture((_request, response) => {
      requestClosed = once(response, 'close');
      response.writeHead(200);
      response.write(Buffer.from([1, 2]));
    });
    const controller = new AbortController();
    const audio = synthesizeChunks(tts, { text: 'hi', format: pcmFormat, signal: controller.signal })
      [Symbol.asyncIterator]();
    await audio.next();
    const next = audio.next();
    controller.abort();
    await expect(next).rejects.toMatchObject({ code: 'cancelled' });
    await requestClosed;
  });

  it('declares only supported capabilities and rejects unsupported formats', async () => {
    const server = await localServer({ http(_request, response) {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ tts: [{ canonical_name: 'aura-2-thalia-en', name: 'thalia', languages: ['en'] }] }));
    } });
    cleanups.push(() => server.close());
    const { tts } = createDeepgramAdapters({
      provider: 'deepgram',
      model: 'nova-3',
      apiKey: 'secret',
      baseUrl: server.url,
    });
    expect(tts.capabilities.streamingText).toBe(false);
    expect(
      (await tts.listVoices!(new AbortController().signal)).every((voice) =>
        voice.id.startsWith('aura-'),
      ),
    ).toBe(true);
    await expect(
      collect(
        synthesizeChunks(tts, {
          text: 'hi',
          format: { ...pcmFormat, sampleRate: 44100 },
          signal: new AbortController().signal,
        }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });
});
