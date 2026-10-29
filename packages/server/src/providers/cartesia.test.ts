import { synthesizeChunks } from '../test-servers.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createCartesiaAdapters } from './cartesia.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function serve(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No port');
  return `http://127.0.0.1:${address.port}`;
}
const format = { kind: 'pcm', encoding: 'pcm_s16le', channels: 1, sampleRate: 24000 } as const;
const signal = () => new AbortController().signal;

describe('Cartesia native SSE', () => {
  it('sends versioned bearer-auth PCM request and yields fragmented SSE audio before done', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let body: unknown;
    let request!: IncomingMessage;
    const baseUrl = await serve(async (req, res) => {
      request = req;
      let text = '';
      for await (const chunk of req) text += chunk;
      body = JSON.parse(text);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(': comment\r\nevent: chunk\r\ndata: {"type":"chunk",');
      res.write('"data":"AQI="}\r\n\r\n');
      await gate;
      res.end('data: {"type":"chunk","data":"AwQ="}\n\ndata: {"type":"done","done":true}\n\n');
    });
    const tts = createCartesiaAdapters({
      provider: 'cartesia',
      // An empty model uses the provider default.
      model: '',
      apiKey: 'test-key',
      baseUrl,
    }).tts;
    const audio = synthesizeChunks(tts, {
        text: 'Hello',
        voice: 'voice',
        speed: 1.2,
        language: 'en',
        format,
        signal: signal(),
      })
      [Symbol.asyncIterator]();
    try {
      expect((await audio.next()).value!.audio).toEqual(Buffer.from([1, 2]));
      expect(request.url).toBe('/tts/sse');
      expect(request.headers.authorization).toBe('Bearer test-key');
      expect(request.headers['cartesia-version']).toBe('2026-08-14');
      expect(body).toEqual({
        model_id: 'sonic-3',
        transcript: 'Hello',
        voice: { mode: 'id', id: 'voice' },
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
        language: 'en',
        generation_config: { speed: 1.2 },
      });
    } finally {
      release();
    }
    expect((await audio.next()).value!.audio).toEqual(Buffer.from([3, 4]));
    expect((await audio.next()).done).toBe(true);
  });

  it('lists every voices page to the terminal cursor', async () => {
    const urls: string[] = [];
    const baseUrl = await serve((req, res) => {
      urls.push(req.url!);
      expect(req.headers['cartesia-version']).toBe('2026-08-14');
      expect(req.headers.authorization).toBe('Bearer key');
      res.end(
        JSON.stringify(
          req.url!.includes('starting_after')
            ? { data: [{ id: 'b', name: 'B', language: 'en' }], has_more: false }
            : { data: [{ id: 'a', name: 'A' }], has_more: true, next_page: 'a' },
        ),
      );
    });
    const tts = createCartesiaAdapters({
      provider: 'cartesia',
      model: 'sonic-3',
      apiKey: 'key',
      baseUrl,
    }).tts;
    expect(await tts.listVoices!(signal())).toEqual([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B', language: 'en' },
    ]);
    expect(urls).toEqual(['/voices?limit=100', '/voices?limit=100&starting_after=a']);
  });

  it.each(['error', 'malformed', 'truncated', 'base64'])(
    'redacts %s stream failures',
    async (kind) => {
      const baseUrl = await serve((_req, res) => {
        const values = {
          error: '{"type":"error","error":"secret"}',
          malformed: 'secret-not-json',
          truncated: '{"type":"chunk","data":"AQI="}',
          base64: '{"type":"chunk","data":"secret?!"}',
        };
        res.end(`data: ${values[kind as keyof typeof values]}\n\n`);
      });
      const tts = createCartesiaAdapters({ provider: 'cartesia', model: 'sonic-3', baseUrl }).tts;
      const consume = async () => {
        for await (const _chunk of synthesizeChunks(tts, {
          text: 'Hi',
          voice: 'id',
          format,
          signal: signal(),
        })) {
          /* drain */
        }
      };
      await expect(consume()).rejects.toMatchObject({
        message: expect.not.stringContaining('secret'),
        code: kind === 'truncated' ? 'transport_error' : 'provider_error',
      });
    },
  );

  it('normalizes HTTP failures and validates format and speed before requests', async () => {
    let calls = 0;
    const baseUrl = await serve((_req, res) => {
      calls++;
      res.writeHead(401);
      res.end('secret');
    });
    const tts = createCartesiaAdapters({ provider: 'cartesia', model: 'sonic-3', baseUrl }).tts;
    const request = { text: 'Hi', voice: 'id', format, signal: signal() };
    await expect(
      synthesizeChunks(tts, { ...request, speed: 5 })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: 'invalid_message' });
    await expect(
      synthesizeChunks(tts, { ...request, format: { kind: 'encoded', mimeType: 'audio/mpeg' } })
        [Symbol.asyncIterator]()
        .next(),
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(calls).toBe(0);
    await expect(synthesizeChunks(tts, request)[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'unauthorized',
      retryable: false,
    });
  });

  it('releases an unfinished stream on iterator return or cancellation', async () => {
    let closed!: () => void;
    const disconnected = new Promise<void>((resolve) => {
      closed = resolve;
    });
    const baseUrl = await serve((_req, res) => {
      res.on('close', closed);
      res.write('data: {"type":"chunk","data":"AQI="}\n\n');
    });
    const tts = createCartesiaAdapters({ provider: 'cartesia', model: 'sonic-3', baseUrl }).tts;
    const controller = new AbortController();
    const audio = synthesizeChunks(tts, { text: 'Hi', voice: 'id', format, signal: controller.signal })
      [Symbol.asyncIterator]();
    await audio.next();
    await audio.return?.();
    await disconnected;
    const cancelled = synthesizeChunks(tts, { text: 'Hi', voice: 'id', format, signal: controller.signal })
      [Symbol.asyncIterator]();
    await cancelled.next();
    controller.abort();
    await expect(cancelled.next()).rejects.toMatchObject({ code: 'cancelled' });
  });
});
