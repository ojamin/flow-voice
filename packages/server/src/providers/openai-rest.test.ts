import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { createOpenAIAdapters } from './openai.js';
import type { SttEvent } from '../index.js';
import { createLiveTranscriptionSession } from '../index.js';

const format = { encoding: 'pcm_s16le' as const, sampleRate: 24000 as const, channels: 1 as const };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture(handler: (request: Request) => Promise<Response> | Response, status = 404) {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const response = await handler(new Request(`http://localhost${req.url}`, {
      method: req.method, headers: req.headers as Record<string, string>,
      body: Buffer.concat(chunks),
    }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.on('upgrade', (_req, socket) => {
    socket.end(`HTTP/1.1 ${status} Not Available\r\nContent-Length: 0\r\n\r\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  return `http://127.0.0.1:${address.port}/prefix/v1`;
}
function pcm(ms: number, value = 2000) {
  const bytes = Buffer.alloc(ms * 48);
  for (let i = 0; i < bytes.length; i += 2) bytes.writeInt16LE(value, i);
  return bytes;
}
function feed(session: { write(bytes: Uint8Array): void }, bytes: Uint8Array) {
  for (let i = 0; i < bytes.length; i += 9600) session.write(bytes.subarray(i, i + 9600));
}
function open(baseUrl: string, options: Record<string, unknown> = { sttTransport: 'rest' }) {
  const controller = new AbortController();
  const adapter = createOpenAIAdapters({ provider: 'openai', baseUrl, model: 'speech-model', options }).stt;
  const session = adapter.open({ format, language: 'en', signal: controller.signal });
  const events: SttEvent[] = [];
  const collected = (async () => { for await (const event of session.events) events.push(event); })();
  cleanup.push(async () => { controller.abort(); await collected; });
  return { session, events, collected, controller, adapter };
}
const json = (text: string) => Response.json({ text });

describe('OpenAI REST dictation', () => {
  it('fails closed when an unconsumed event queue fills', async () => {
    const url = await fixture(() => json('word'));
    const controller = new AbortController();
    const session = createOpenAIAdapters({ provider: 'openai', baseUrl: url, model: 'speech-model', options: { sttTransport: 'rest' } }).stt.open({ format, signal: controller.signal });
    cleanup.push(async () => { controller.abort(); await session.end(); });
    for (let i = 0; i < 35; i++) feed(session, Buffer.concat([pcm(100), pcm(600, 0)]));
    await session.end();
    const events: SttEvent[] = [];
    for await (const event of session.events) events.push(event);
    expect(events).toEqual([
      expect.objectContaining({ type: 'error', code: 'limit_exceeded' }),
      { type: 'ended', reason: 'error' },
    ]);
  });

  it('updates full committed/empty tentative on a pause before stop', async () => {
    const url = await fixture(() => json('Live chunk'));
    const controller = new AbortController();
    let updated!: () => void;
    const update = new Promise<void>((resolve) => { updated = resolve; });
    const runner = createLiveTranscriptionSession({
      adapter: createOpenAIAdapters({ provider: 'openai', baseUrl: url, model: 'speech-model', options: { sttTransport: 'rest' } }).stt,
      signal: controller.signal,
      async send(message) {
        if (message.type === 'partial' && message.committed === 'Live chunk' && message.tentative === '') updated();
      },
    });
    cleanup.push(async () => { controller.abort(); await runner.done; });
    await runner.receive({ type: 'start', version: 1, audio: format });
    const audio = Buffer.concat([pcm(100), pcm(600, 0)]);
    for (let i = 0; i < audio.length; i += 9600)
      await runner.receive({ type: 'audio', audio: audio.subarray(i, i + 9600) });
    await update;
    await runner.receive({ type: 'stop' });
    await runner.done;
  });

  it('bounds pending PCM while a request is active and cancels without sending queued chunks', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let arrived!: () => void;
    const arrival = new Promise<void>((resolve) => { arrived = resolve; });
    let requests = 0;
    const url = await fixture(async () => { requests++; arrived(); await gate; return json('late'); });
    const { session, controller, collected, events } = open(url);
    feed(session, pcm(36000));
    expect(() => session.write(pcm(20))).toThrow(expect.objectContaining({ code: 'limit_exceeded' }));
    await arrival;
    controller.abort();
    await session.end(); await collected; release();
    expect(requests).toBe(1);
    expect(events).toEqual([{ type: 'ended', reason: 'cancelled' }]);
  });

  it('posts WAV/multipart with prefix, pauses and max chunks; appends in order and flushes end', async () => {
    const bodies: Buffer[] = [];
    let active = 0, maxActive = 0;
    const url = await fixture(async (request) => {
      active++;
      maxActive = Math.max(maxActive, active);
      expect(new URL(request.url).pathname).toBe('/prefix/v1/audio/transcriptions');
      const form = await request.formData();
      expect(form.get('model')).toBe('speech-model');
      expect(form.get('language')).toBe('en');
      expect(form.get('response_format')).toBe('json');
      const file = form.get('file') as File;
      expect(file.type).toBe('audio/wav');
      const body = Buffer.from(await file.arrayBuffer());
      bodies.push(body);
      expect(body.toString('ascii', 0, 4)).toBe('RIFF');
      expect(body.readUInt32LE(4)).toBe(body.length - 8);
      expect(body.toString('ascii', 8, 16)).toBe('WAVEfmt ');
      expect(body.readUInt32LE(16)).toBe(16);
      expect(body.readUInt16LE(20)).toBe(1);
      expect(body.readUInt16LE(22)).toBe(1);
      expect(body.readUInt32LE(24)).toBe(24000);
      expect(body.readUInt32LE(28)).toBe(48000);
      expect(body.readUInt16LE(32)).toBe(2);
      expect(body.readUInt16LE(34)).toBe(16);
      expect(body.toString('ascii', 36, 40)).toBe('data');
      expect(body.readUInt32LE(40)).toBe(body.length - 44);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return json([' Hello ', 'world', '!'][bodies.length - 1]!);
    });
    const { session, events, collected, adapter } = open(url);
    expect(adapter.capabilities.interim).toBe(false);
    const first = Buffer.concat([pcm(100), pcm(600, 0)]);
    feed(session, first);
    feed(session, pcm(12000));
    feed(session, pcm(100));
    await session.end();
    await collected;
    expect(maxActive).toBe(1);
    expect(bodies.map((b) => b.length - 44)).toEqual([33600, 576000, 4800]);
    expect(bodies[0]!.subarray(44)).toEqual(first);
    expect(events.filter((e) => e.type === 'final').map((e) => e.text)).toEqual(['Hello', ' world', '!']);
    expect(events.filter((e) => e.type === 'partial')).toEqual([0, 1, 2].map((revision) => ({ type: 'partial', revision, text: '' })));
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'stopped' });
  });

  it.each([404, 405, 426])('falls back only before readiness on realtime %s', async (status) => {
    let requests = 0;
    const url = await fixture(() => { requests++; return json('Fallback'); }, status);
    const { session, events, collected, adapter } = open(url, {});
    feed(session, pcm(100));
    await session.end();
    await collected;
    expect(requests).toBe(1);
    expect(events).toContainEqual({ type: 'final', mode: 'append', text: 'Fallback' });
    expect(adapter.capabilities.interim).toBe(false);
  });

  it('does not fall back on authentication rejection', async () => {
    let requests = 0;
    const url = await fixture(() => { requests++; return json('wrong'); }, 401);
    const { session, events, collected } = open(url, {});
    feed(session, pcm(100));
    await session.end(); await collected;
    expect(requests).toBe(0);
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('flushes no request for empty end and rejects unsupported transport', async () => {
    const url = await fixture(() => { throw new Error('unexpected request'); });
    const { session, collected } = open(url);
    await session.end(); await collected;
    expect(() => open(url, { sttTransport: 'invalid' })).toThrow();
  });

  it.each(['timeout', 'cancel', 'redirect', 'oversized'] as const)('bounds %s', async (mode) => {
    let arrived!: () => void;
    const arrival = new Promise<void>((resolve) => { arrived = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const url = await fixture(async () => {
      arrived();
      if (mode === 'timeout' || mode === 'cancel') await gate;
      if (mode === 'redirect') return new Response('', { status: 302, headers: { location: '/forbidden' } });
      return json(mode === 'oversized' ? 'x'.repeat(70000) : 'late');
    });
    const { session, controller, collected, events } = open(url, { sttTransport: 'rest', sttRequestTimeoutMs: 100 });
    feed(session, pcm(100));
    const ended = session.end();
    await arrival;
    if (mode === 'cancel') controller.abort();
    await ended; await collected; release();
    expect(events.filter((e) => e.type === 'final')).toEqual([]);
    if (mode === 'cancel') expect(events.at(-1)).toEqual({ type: 'ended', reason: 'cancelled' });
    else expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: mode === 'timeout' ? 'timeout' : mode === 'oversized' ? 'limit_exceeded' : 'transport_error' }));
  });
});
