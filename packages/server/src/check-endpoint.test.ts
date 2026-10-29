import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { createAdapters, checkSpeechEndpoint } from './index.js';
import { createFakeAdapters } from './testing.js';
import { localServer, deferred } from './test-servers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const signal = () => new AbortController().signal;
const secret = 'private-test-key';

it('probes real TTS audio with the default voice/format, then cancels after the first chunk', async () => {
  const closed = deferred<void>();
  const requests: string[] = [];
  let requestBody = '';
  const server = await localServer({ http(request, response) {
    requests.push(request.url!);
    if (request.url === '/audio/voices') {
      response.end(JSON.stringify({ voices: [{ id: 'nova', name: 'Nova' }] }));
    } else {
      request.on('data', (data) => { requestBody += data; });
      request.on('end', () => {
        response.writeHead(200, { 'Content-Type': 'audio/pcm' });
        response.write(Buffer.from([1, 2]));
      });
      response.on('close', () => closed.resolve());
    }
  } });
  cleanups.push(() => server.close());
  const { tts } = createAdapters({ provider: 'openai', model: 'configured-model', apiKey: secret, baseUrl: server.url });
  const result = await checkSpeechEndpoint({ tts: tts!, signal: signal() });
  await closed.promise;
  expect(result).toEqual({ tts: { ok: true, voices: [{ id: 'nova', name: 'Nova', isDefault: true }] } });
  expect(requests).toEqual(['/audio/voices', '/audio/speech']);
  expect(JSON.parse(requestBody)).toMatchObject({ input: 'Test.', voice: 'nova', model: 'configured-model', response_format: 'pcm' });
});

it.each(['openai', 'deepgram', 'assemblyai', 'elevenlabs', 'moss-compat'])('waits for %s provider acceptance, then closes without sending audio', async (provider) => {
  const frames: unknown[] = [];
  let closed: Promise<unknown> | undefined;
  const server = await localServer({ ws(socket) {
    closed = once(socket, 'close');
    socket.on('message', (data, binary) => {
      frames.push(binary ? data : JSON.parse(data.toString()));
      if (provider === 'openai') socket.send(JSON.stringify({ type: 'session.updated' }));
    });
    if (provider === 'assemblyai') socket.send(JSON.stringify({ type: 'Begin' }));
    if (provider === 'elevenlabs') socket.send(JSON.stringify({ message_type: 'session_started' }));
    if (provider === 'moss-compat') socket.send(JSON.stringify({ type: 'session.ready' }));
  } });
  cleanups.push(() => server.close());
  const { stt } = createAdapters({ provider, model: '', apiKey: secret, baseUrl: server.url });
  await expect(checkSpeechEndpoint({ stt: stt!, signal: signal() })).resolves.toEqual({ stt: { ok: true, verified: true } });
  await closed;
  // OpenAI and MOSS send setup JSON only; no binary or base64 audio/commit frames.
  expect(frames.every((frame) => typeof frame === 'object' && !Buffer.isBuffer(frame) &&
    ['session.update', 'start'].includes((frame as { type: string }).type))).toBe(true);
});

it.each([false, true])('verifies REST transcription with a silent WAV (realtime fallback: %s)', async (fallback) => {
  const requests: string[] = [];
  let bytes = Buffer.alloc(0);
  const server = createServer((request, response) => {
    requests.push(request.url!);
    request.on('data', (chunk) => { bytes = Buffer.concat([bytes, chunk]); });
    request.on('end', () => response.end(JSON.stringify({ text: '' })));
  });
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const { stt } = createAdapters({ provider: 'openai', model: 'transcribe-model', apiKey: secret,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    options: { sttTransport: fallback ? 'realtime' : 'rest' } });
  await expect(checkSpeechEndpoint({ stt: stt!, signal: signal() })).resolves.toEqual({ stt: { ok: true, verified: true } });
  expect(requests).toEqual(['/audio/transcriptions']);
  const wav = bytes.indexOf(Buffer.from('RIFF'));
  expect(wav).toBeGreaterThan(0);
  expect(bytes.subarray(wav + 44, wav + 44 + 960)).toEqual(Buffer.alloc(960));
  expect(bytes.toString()).toContain('transcribe-model');
});

it.each(['tts', 'stt'] as const)('rejects a real %s HTTP 401 without leaking provider details', async (kind) => {
  const server = await localServer({ http(_request, response) { response.writeHead(401).end(secret); } });
  cleanups.push(() => server.close());
  const adapters = createAdapters({ provider: 'openai', model: '', apiKey: secret, baseUrl: server.url, options: { sttTransport: 'rest' } });
  await expect(checkSpeechEndpoint({ [kind]: adapters[kind], signal: signal() })).rejects.toMatchObject({
    code: 'unauthorized', message: 'Speech provider authentication failed.',
  });
});

it.each(['tts', 'stt'] as const)('rejects unreachable %s endpoints', async (kind) => {
  const server = await localServer({});
  await server.close();
  const adapters = createAdapters({ provider: 'openai', model: '', apiKey: secret, baseUrl: server.url });
  await expect(checkSpeechEndpoint({ [kind]: adapters[kind], signal: signal() })).rejects.toMatchObject({ code: 'transport_error' });
});

it.each(['tts', 'stt', 'rest'] as const)('bounds stalled %s probes and closes the connection', async (kind) => {
  const closed = deferred<void>();
  const server = await localServer({
    http(request, response) {
      if (request.url === '/audio/voices') response.end(JSON.stringify(['alloy']));
      else response.on('close', () => closed.resolve());
    },
    ws(socket) { socket.on('close', () => closed.resolve()); },
  });
  cleanups.push(() => server.close());
  const adapters = createAdapters({ provider: 'openai', model: '', apiKey: secret, baseUrl: server.url,
    options: { sttTransport: kind === 'rest' ? 'rest' : 'realtime' } });
  const key = kind === 'rest' ? 'stt' : kind;
  await expect(checkSpeechEndpoint({ [key]: adapters[key], signal: signal(), timeoutMs: 100 })).rejects.toMatchObject({ code: 'timeout' });
  await closed.promise;
});

it.each(['tts', 'stt', 'rest'] as const)('cancels active %s probes and releases the connection', async (kind) => {
  const started = deferred<void>();
  const closed = deferred<void>();
  const server = await localServer({
    http(request, response) {
      if (request.url === '/audio/voices') response.end(JSON.stringify(['alloy']));
      else { response.on('close', () => closed.resolve()); started.resolve(); }
    },
    ws(socket) { socket.on('close', () => closed.resolve()); started.resolve(); },
  });
  cleanups.push(() => server.close());
  const adapters = createAdapters({ provider: 'openai', model: '', apiKey: secret, baseUrl: server.url,
    options: { sttTransport: kind === 'rest' ? 'rest' : 'realtime' } });
  const key = kind === 'rest' ? 'stt' : kind;
  const controller = new AbortController();
  const check = checkSpeechEndpoint({ [key]: adapters[key], signal: controller.signal });
  const rejection = expect(check).rejects.toMatchObject({ code: 'cancelled' });
  await started.promise;
  controller.abort(new Error(secret));
  await rejection;
  await closed.promise;
});

it('cancels before contacting a provider', async () => {
  const tts = createFakeAdapters().tts;
  const synthesize = vi.spyOn(tts, 'synthesize');
  await expect(checkSpeechEndpoint({ tts, signal: AbortSignal.abort(secret) })).rejects.toMatchObject({ code: 'cancelled' });
  expect(synthesize).not.toHaveBeenCalled();
});

it('skips absent catalogs, rejects empty audio and sanitizes lazy failures', async () => {
  const original = createFakeAdapters().tts;
  const tts = { ...original, capabilities: { ...original.capabilities, voices: 'none' as const } };
  const list = vi.spyOn(tts, 'listVoices');
  await expect(checkSpeechEndpoint({ tts, signal: signal() })).resolves.toEqual({ tts: { ok: true, voices: [] } });
  expect(list).not.toHaveBeenCalled();
  tts.synthesize = async function () { return { format: original.capabilities.formats[0]!, mimeType: 'audio/pcm', stream: new ReadableStream({ start(c) { c.close(); } }) }; };
  await expect(checkSpeechEndpoint({ tts, signal: signal() })).rejects.toMatchObject({ code: 'provider_error' });
  tts.synthesize = async function () { return { format: original.capabilities.formats[0]!, mimeType: 'audio/pcm', stream: new ReadableStream({ start(c) { c.error(new Error(secret)); } }) }; };
  await expect(checkSpeechEndpoint({ tts, signal: signal() })).rejects.toMatchObject({ code: 'provider_error', message: 'Speech provider failed.' });
});

it.each(['openai', 'deepgram', 'assemblyai', 'elevenlabs', 'moss-compat'])('rejects %s WebSocket authentication failures safely', async (provider) => {
  const server = createServer();
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const { stt } = createAdapters({ provider, model: '', apiKey: secret,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
  await expect(checkSpeechEndpoint({ stt: stt!, signal: signal() })).rejects.toMatchObject({
    code: 'unauthorized', message: 'Speech provider authentication failed.',
  });
});

it('can check both kinds and returns only the requested results', async () => {
  await expect(checkSpeechEndpoint({ ...createFakeAdapters(), signal: signal() })).resolves.toEqual({
    stt: { ok: true, verified: true }, tts: { ok: true, voices: [{ id: 'fake', name: 'Test voice' }] },
  });
});

it.each([0, -1, NaN, Infinity, 0.5, 2_147_483_648])('rejects an invalid timeout: %s', async (timeoutMs) => {
  await expect(checkSpeechEndpoint({ tts: createFakeAdapters().tts, signal: signal(), timeoutMs })).rejects.toMatchObject({ code: 'invalid_message' });
});

it('requires an adapter', async () => {
  await expect(checkSpeechEndpoint({ signal: signal() })).rejects.toMatchObject({ code: 'invalid_message' });
});
