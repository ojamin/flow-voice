import { speechError } from '../errors.js';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createElevenLabsAdapters } from './elevenlabs.js';

const resources: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of resources.splice(0).reverse()) await cleanup();
});
async function serve(handler?: (req: IncomingMessage, res: ServerResponse) => void) {
  const server: Server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  resources.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1` };
}
const format = { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 } as const;
const pcm = { kind: 'pcm', ...format } as const;
const signal = () => new AbortController().signal;

describe('ElevenLabs native adapters', () => {
  it('authenticates Scribe, yields revisioned partials before end, pads and commits then closes', async () => {
    const { server, baseUrl } = await serve();
    const ws = new WebSocketServer({ server });
    resources.push(async () => {
      for (const client of ws.clients) client.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
    });
    const chunks: {
      audio_base_64: string;
      commit: boolean;
      sample_rate: number;
      message_type: string;
    }[] = [];
    const connected = new Promise<IncomingMessage>((resolve) =>
      ws.on('connection', (client, req) => {
        resolve(req);
        client.send(JSON.stringify({ message_type: 'session_started', session_id: 'session' }));
        client.on('message', (raw) => {
          const message = JSON.parse(raw.toString());
          chunks.push(message);
          if (message.commit)
            client.send(
              JSON.stringify({ message_type: 'committed_transcript', text: 'Hello world' }),
            );
          else if (chunks.length === 1) {
            client.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Hello' }));
            client.send(
              JSON.stringify({ message_type: 'partial_transcript', text: 'Hello world' }),
            );
          }
        });
      }),
    );
    const { stt } = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'scribe_v2_realtime',
      apiKey: 'test-key',
      baseUrl,
    });
    const session = stt.open({ format, language: 'en', signal: signal() });
    session.write(new Uint8Array([1, 2, 3, 4])); // Also proves admission before handshake.
    const req = await connected;
    expect(req.headers['xi-api-key']).toBe('test-key');
    const url = new URL(req.url!, baseUrl);
    expect(url.pathname).toBe('/v1/speech-to-text/realtime');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      model_id: 'scribe_v2_realtime',
      audio_format: 'pcm_16000',
      commit_strategy: 'manual',
      language_code: 'en',
    });
    const events = session.events[Symbol.asyncIterator]();
    expect((await events.next()).value).toEqual({ type: 'partial', revision: 1, text: 'Hello' });
    expect((await events.next()).value).toEqual({
      type: 'partial',
      revision: 2,
      text: 'Hello world',
    });
    const ended = session.end();
    expect((await events.next()).value).toEqual({
      type: 'final',
      mode: 'append',
      text: 'Hello world',
    });
    expect((await events.next()).value).toEqual({ type: 'ended', reason: 'stopped' });
    expect((await events.next()).done).toBe(true);
    await ended;
    expect(
      chunks.every((c) => c.message_type === 'input_audio_chunk' && c.sample_rate === 16000),
    ).toBe(true);
    expect(Buffer.from(chunks[0].audio_base_64, 'base64')).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(chunks.reduce((sum, c) => sum + Buffer.from(c.audio_base_64, 'base64').length, 0)).toBe(
      9600,
    );
    expect(chunks.at(-1)).toMatchObject({ audio_base_64: '', commit: true });
  });

  it('caps pre-handshake PCM, rejects invalid frames and cancels pending transcripts', async () => {
    const { server, baseUrl } = await serve();
    const ws = new WebSocketServer({ server });
    resources.push(async () => {
      for (const c of ws.clients) c.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
    });
    const controller = new AbortController();
    const session = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'scribe_v2_realtime',
      baseUrl,
    }).stt.open({ format, signal: controller.signal });
    expect(() => session.write(new Uint8Array(3))).toThrow(
      expect.objectContaining({ code: 'invalid_message' }),
    );
    for (let i = 0; i < 9; i++) session.write(new Uint8Array(32000));
    expect(() => session.write(new Uint8Array(32000))).toThrow(
      expect.objectContaining({ code: 'limit_exceeded' }),
    );
    controller.abort();
    const events = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([{ type: 'ended', reason: 'cancelled' }]);
    await session.end();
  });

  it('redacts upstream errors', async () => {
    const { server, baseUrl } = await serve();
    const ws = new WebSocketServer({ server });
    resources.push(async () => {
      for (const c of ws.clients) c.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
    });
    ws.on('connection', (client) =>
      client.send(
        JSON.stringify({ message_type: 'auth_error', error: 'secret api key in upstream URL' }),
      ),
    );
    const session = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'scribe_v2_realtime',
      baseUrl,
    }).stt.open({ format, signal: signal() });
    const events = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([
      {
        type: 'error',
        code: 'unauthorized',
        retryable: false,
        message: speechError('unauthorized').message,
      },
      { type: 'ended', reason: 'error' },
    ]);
    await session.end();
  });

  it('releases an active socket when the event consumer returns', async () => {
    const { server, baseUrl } = await serve();
    const ws = new WebSocketServer({ server });
    resources.push(async () => {
      for (const c of ws.clients) c.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
    });
    let disconnected!: () => void;
    const closed = new Promise<void>((resolve) => {
      disconnected = resolve;
    });
    ws.on('connection', (client) => {
      client.on('close', disconnected);
      client.send(JSON.stringify({ message_type: 'session_started' }));
      client.send(JSON.stringify({ message_type: 'partial_transcript', text: 'Hi' }));
    });
    const session = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'scribe_v2_realtime',
      baseUrl,
    }).stt.open({ format, signal: signal() });
    const events = session.events[Symbol.asyncIterator]();
    expect((await events.next()).value).toMatchObject({ type: 'partial' });
    await events.return?.();
    await closed;
    await session.end();
  });

  it('releases a socket even when the consumer returns before its first next', async () => {
    const { server, baseUrl } = await serve();
    const ws = new WebSocketServer({ server });
    resources.push(async () => {
      for (const c of ws.clients) c.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
    });
    const session = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'scribe_v2_realtime',
      baseUrl,
    }).stt.open({ format, signal: signal() });
    await session.events[Symbol.asyncIterator]().return?.();
    await session.end();
  });

  it('normalizes a rejected WebSocket handshake', async () => {
    const { baseUrl } = await serve((_req, res) => {
      res.writeHead(401);
      res.end('secret');
    });
    const session = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'scribe_v2_realtime',
      baseUrl,
    }).stt.open({ format, signal: signal() });
    const events = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([
      {
        type: 'error',
        code: 'unauthorized',
        retryable: false,
        message: speechError('unauthorized').message,
      },
      { type: 'ended', reason: 'error' },
    ]);
    await session.end();
  });

  it('streams HTTP PCM before response end and sends voice, model, language and speed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let request!: IncomingMessage;
    let body: unknown;
    const { baseUrl } = await serve(async (req, res) => {
      request = req;
      let text = '';
      for await (const chunk of req) text += chunk;
      body = JSON.parse(text);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.write(Buffer.from([1, 2]));
      await gate;
      res.end(Buffer.from([3, 4]));
    });
    const { tts } = createElevenLabsAdapters({
      provider: 'elevenlabs',
      model: 'eleven_flash_v2_5',
      baseUrl,
      apiKey: 'test-key',
    });
    const audio = tts
      .synthesize({
        text: 'Hello',
        voice: 'voice/id',
        speed: 1.1,
        language: 'en',
        format: pcm,
        signal: signal(),
      })
      [Symbol.asyncIterator]();
    try {
      expect((await audio.next()).value!.audio).toEqual(new Uint8Array([1, 2]));
      expect(request.url).toBe('/v1/text-to-speech/voice%2Fid/stream?output_format=pcm_16000');
      expect(request.headers['xi-api-key']).toBe('test-key');
      expect(body).toEqual({
        text: 'Hello',
        model_id: 'eleven_flash_v2_5',
        language_code: 'en',
        voice_settings: { speed: 1.1 },
      });
    } finally {
      release();
    }
    expect((await audio.next()).value!.audio).toEqual(new Uint8Array([3, 4]));
    expect((await audio.next()).done).toBe(true);
  });

  it('lists voices, supports MP3, rejects unsupported formats and normalizes HTTP errors', async () => {
    const { baseUrl } = await serve((req, res) => {
      if (req.url === '/v1/voices')
        res.end(JSON.stringify({ voices: [{ voice_id: 'id', name: 'Voice' }] }));
      else if (req.url?.includes('mp3_44100_128')) res.end(Buffer.from([4, 5]));
      else {
        res.writeHead(429);
        res.end('secret');
      }
    });
    const { tts } = createElevenLabsAdapters({ provider: 'elevenlabs', model: 'model', baseUrl });
    expect(await tts.listVoices!(signal())).toEqual([{ id: 'id', name: 'Voice' }]);
    const mp3 = tts.synthesize({
      text: 'text',
      voice: 'voice',
      format: { kind: 'encoded', mimeType: 'audio/mpeg' },
      signal: signal(),
    });
    for await (const chunk of mp3) expect(chunk.audio).toEqual(new Uint8Array([4, 5]));
    const request = { text: 'text', voice: 'voice', format: pcm, signal: signal() };
    await expect(tts.synthesize(request)[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'rate_limited',
      retryable: true,
    });
    await expect(
      tts
        .synthesize({ ...request, format: { ...pcm, sampleRate: 48000 } })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('aborts an active HTTP reader', async () => {
    const { baseUrl } = await serve((_req, res) => {
      res.writeHead(200);
      res.write(Buffer.from([1, 2]));
    });
    const controller = new AbortController();
    const tts = createElevenLabsAdapters({ provider: 'elevenlabs', model: 'model', baseUrl }).tts;
    const audio = tts
      .synthesize({ text: 'Hello', voice: 'id', format: pcm, signal: controller.signal })
      [Symbol.asyncIterator]();
    await audio.next();
    controller.abort();
    await expect(audio.next()).rejects.toMatchObject({ code: 'cancelled' });
  });
});
