import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkedFetch, parseVoices, responseJson, openSpeechSocket } from './transport.js';
import { localServer } from './test-servers.js';
import { createCartesiaAdapters } from './providers/cartesia.js';

describe('provider redirect and catalog boundaries', () => {
  it.each([301, 302, 307, 308])(
    'rejects %s without forwarding credentials to another origin or HTTP target',
    async (status) => {
      const received: unknown[] = [];
      const target = await localServer({
        http(req, res) {
          received.push(req.headers);
          res.end('{}');
        },
      });
      const source = await localServer({
        http(_req, res) {
          res.writeHead(status, { location: target.url }).end();
        },
      });
      try {
        await expect(
          checkedFetch(source.url, {
            headers: { 'xi-api-key': 'secret', Authorization: 'Bearer secret' },
          }),
        ).rejects.toMatchObject({ code: 'transport_error' });
        expect(received).toEqual([]);
      } finally {
        await source.close();
        await target.close();
      }
    },
  );
  it('rejects WebSocket redirects without dialing their target', async () => {
    let requests = 0;
    const target = await localServer({
      ws(socket) {
        requests++;
        socket.close();
      },
      http(_req, res) {
        requests++;
        res.end();
      },
    });
    const source = createServer();
    source.on('upgrade', (_req, socket) => {
      socket.end(
        `HTTP/1.1 302 Found\r\nLocation: ${target.url.replace('http:', 'ws:')}\r\nConnection: close\r\n\r\n`,
      );
    });
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    const address = source.address() as { port: number };
    try {
      const socket = openSpeechSocket({
        url: `ws://127.0.0.1:${address.port}`,
        headers: { Authorization: 'Bearer secret' },
        signal: new AbortController().signal,
      });
      await expect(socket.messages[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'provider_error',
      });
      socket.close();
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => source.close(() => resolve()));
      await target.close();
    }
  });
  it('cancels oversized response bodies before parsing and rejects oversized fields/counts', async () => {
    await expect(responseJson(new Response(' '.repeat(65)), 64)).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    expect(() => parseVoices([{ id: 'x', name: 'n'.repeat(257) }])).toThrow();
    expect(() =>
      parseVoices(Array.from({ length: 1001 }, () => ({ id: 'x', name: 'x' }))),
    ).toThrow();
  });
  it('terminates excessive pagination at ten pages before accumulating more voices', async () => {
    let calls = 0;
    const fixture = await localServer({
      http(_req, res) {
        calls++;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: [{ id: String(calls), name: 'voice' }], has_more: true }));
      },
    });
    try {
      const { tts } = createCartesiaAdapters({
        provider: 'cartesia',
        baseUrl: fixture.url,
        model: '',
        apiKey: 'secret',
      });
      await expect(tts.listVoices!(new AbortController().signal)).rejects.toMatchObject({
        code: 'limit_exceeded',
      });
      expect(calls).toBe(10);
    } finally {
      await fixture.close();
    }
  });
});
