import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { checkSpeechEndpoint, createAdapters, prepareSpeechEndpoint } from './index.js';
import type { SpeechTransportOptions, SpeechWebSocket } from './index.js';

// Prove that injected factories bypass the default Node socket, not just the browser global.
vi.mock('ws', () => ({ default: class {
  static OPEN = 1;
  constructor() { throw new Error('Default WebSocket must not be used'); }
} }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const signal = () => new AbortController().signal;
const baseUrl = 'http://172.17.0.1:3100';
const model = 'nemotron-speech-streaming-en-0.6b-gguf';

class FakeSocket extends EventEmitter implements SpeechWebSocket {
  readyState = 0;
  bufferedAmount = 0;
  constructor(provider: string, missing = false) {
    super();
    queueMicrotask(() => {
      if (missing) {
        this.emit('unexpected-response', {}, { statusCode: 404, resume() {} });
        return;
      }
      this.readyState = 1;
      this.emit('open');
      if (provider === 'assemblyai') this.message({ type: 'Begin' });
      if (provider === 'elevenlabs') this.message({ message_type: 'session_started' });
    });
  }
  message(value: unknown) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  send(data: string | Uint8Array, callback?: (error?: Error) => void) {
    if (typeof data === 'string') {
      const event = JSON.parse(data);
      if (event.type === 'session.update') this.message({ type: 'session.updated' });
      if (event.type === 'start') this.message({ type: 'session.ready' });
    }
    callback?.();
  }
  close() { this.terminate(); }
  terminate() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    queueMicrotask(() => this.emit('close', 1006, Buffer.alloc(0)));
  }
}

function forbidGlobals() {
  vi.stubGlobal('fetch', () => { throw new Error('Global fetch must not be used'); });
  vi.stubGlobal('WebSocket', () => { throw new Error('Global WebSocket must not be used'); });
}

it.each(['openai', 'moss-compat'])('corrects %s REST-only endpoints once, discovers models, and serializes the result', async (provider) => {
  forbidGlobals();
  const requests: string[] = [];
  const sockets: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push(url);
    expect(input instanceof URL || typeof input === 'string').toBe(true);
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({}); // Local endpoints need no placeholder key.
    if (url.endsWith('/models')) return Response.json({ data: [{ id: model }, { id: 42 }, {}, null, { id: model }] });
    if (url.endsWith('/v1/audio/transcriptions')) {
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init!.body as FormData;
      expect(form.get('model')).toBe(model);
      const wav = new DataView(await (form.get('file') as Blob).arrayBuffer());
      expect(wav.getUint32(24, true)).toBe(provider === 'moss-compat' ? 16000 : 24000);
      expect(wav.getUint16(22, true)).toBe(1);
      return Response.json({ text: '' });
    }
    return new Response(null, { status: 404 });
  };
  const transport: SpeechTransportOptions = { fetch, webSocket: (url, options) => {
    sockets.push(String(url));
    expect(options.followRedirects).toBe(false);
    return new FakeSocket(provider, true);
  } };
  const { stt } = prepareSpeechEndpoint({ kind: 'stt', draft: { provider, model, baseUrl }, ...transport });
  const result = await checkSpeechEndpoint({ stt, signal: signal() });
  expect(JSON.parse(JSON.stringify(result))).toEqual({
    stt: { ok: true, verified: true, live: false }, baseUrl: `${baseUrl}/v1`, models: [model],
  });
  expect(requests).toEqual([`${baseUrl}/audio/transcriptions`, `${baseUrl}/v1/audio/transcriptions`, `${baseUrl}/v1/models`]);
  expect(sockets).toHaveLength(2);
  expect(sockets[1]).not.toContain('/v1/v1/');
});

it.each([
  [baseUrl, 401, 1], [baseUrl, 500, 1], [`${baseUrl}/v1`, 404, 1], [baseUrl, 404, 2],
] as const)('does not guess paths beyond one /v1 retry (%s, %s)', async (baseUrl, status, attempts) => {
  forbidGlobals();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status }));
  const { stt } = createAdapters({ provider: 'openai', model, baseUrl, options: { sttTransport: 'rest' } }, { fetch });
  await expect(checkSpeechEndpoint({ stt, signal: signal() })).rejects.toMatchObject({ code: status === 401 ? 'unauthorized' : 'provider_error' });
  expect(fetch).toHaveBeenCalledTimes(attempts);
});

it.each(['failed', 'malformed', 'oversized', 'timeout'])('keeps a successful Test when model discovery is %s', async (failure) => {
  forbidGlobals();
  const fetch: typeof globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/models')) {
      if (failure === 'failed') return new Response(null, { status: 500 });
      if (failure === 'malformed') return new Response('{');
      if (failure === 'oversized') return new Response(' '.repeat(1_048_577));
      return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
    }
    return Response.json({ text: '' });
  };
  const { stt } = createAdapters({ provider: 'openai', model, baseUrl, options: { sttTransport: 'rest' } }, { fetch });
  expect(await checkSpeechEndpoint({ stt, signal: signal(), timeoutMs: 100 })).toEqual({ stt: { ok: true, verified: true } });
});

it('bounds model ids to 1000 strings of at most 200 characters', async () => {
  const fetch: typeof globalThis.fetch = async (url) => String(url).endsWith('/models')
    ? Response.json({ data: [{ id: '' }, { id: 'x'.repeat(201) }, ...Array.from({ length: 1100 }, (_, i) => ({ id: `model-${i}` }))] })
    : Response.json({ text: '' });
  const { stt } = createAdapters({ provider: 'openai', model, baseUrl, options: { sttTransport: 'rest' } }, { fetch });
  const result = await checkSpeechEndpoint({ stt, signal: signal() });
  expect(result.models).toHaveLength(1000);
  expect(result.models?.[0]).toBe('model-0');
  expect(result.models?.at(-1)).toBe('model-999');
});

it('reports custom voice discovery failures without suggesting OpenAI names', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 404 }));
  const { tts } = createAdapters({ provider: 'openai', model, baseUrl: `${baseUrl}/v1` }, { fetch });
  const result = await checkSpeechEndpoint({ tts, signal: signal() });
  expect(JSON.parse(JSON.stringify(result))).toEqual({ voiceError: "Couldn't load voices from this server" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['voices', 'speech'])('corrects a TTS 404 at audio/%s and retains same-origin authentication', async (missing) => {
  forbidGlobals();
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    const address = String(url);
    requests.push(address);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer saved-key' });
    if (address === `${baseUrl}/audio/${missing}`) return new Response(null, { status: 404 });
    if (address.endsWith('/voices')) return Response.json({ voices: ['custom-voice'] });
    if (address.endsWith('/models')) return Response.json({ data: [{ id: 'tts-model' }] });
    return new Response(new Uint8Array([1, 2]));
  };
  const { tts } = createAdapters({ provider: 'openai', model: 'tts-model', baseUrl, apiKey: 'saved-key' }, { fetch });
  const result = await checkSpeechEndpoint({ tts, signal: signal() });
  expect(result).toEqual({ baseUrl: `${baseUrl}/v1`, models: ['tts-model'], tts: {
    ok: true, voices: [{ id: 'custom-voice', name: 'custom-voice', isDefault: true }],
  } });
  expect(requests.filter((url) => url === `${baseUrl}/audio/${missing}`)).toHaveLength(1);
  expect(requests.at(-1)).toBe(`${baseUrl}/v1/models`);
});

it('does not claim live is unavailable when REST was explicitly selected', async () => {
  const webSocket = vi.fn(() => { throw new Error('REST must not open a socket'); });
  const fetch: typeof globalThis.fetch = async (url) => String(url).endsWith('/models')
    ? Response.json({ data: [] }) : Response.json({ text: '' });
  const { stt } = createAdapters({ provider: 'openai', model, baseUrl, options: { sttTransport: 'rest' } }, { fetch, webSocket });
  expect(await checkSpeechEndpoint({ stt, signal: signal() })).toEqual({ stt: { ok: true, verified: true }, models: [] });
  expect(webSocket).not.toHaveBeenCalled();
});

it.each(['openai', 'moss-compat', 'deepgram', 'assemblyai', 'elevenlabs'])('uses the host socket factory for every %s live probe, including authentication', async (provider) => {
  forbidGlobals();
  const webSocket = vi.fn<NonNullable<SpeechTransportOptions['webSocket']>>(() => new FakeSocket(provider));
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [{ id: model }] }));
  const { stt } = createAdapters({ provider, model, baseUrl, apiKey: 'host-bound-secret' }, { fetch, webSocket });
  expect(await checkSpeechEndpoint({ stt, signal: signal() })).toEqual({ stt: { ok: true, verified: true, live: true }, models: [model] });
  const [url, options] = webSocket.mock.calls[0]!;
  expect(String(url)).toMatch(/^ws:\/\/172\.17\.0\.1:3100\//);
  expect(Object.values(options.headers ?? {})).toContain(provider === 'deepgram' ? 'Token host-bound-secret'
    : provider === 'assemblyai' || provider === 'elevenlabs' ? 'host-bound-secret' : 'Bearer host-bound-secret');
  expect(options.followRedirects).toBe(false);
  expect(webSocket).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(['openai', 'moss-compat', 'deepgram', 'cartesia', 'elevenlabs'])('uses the host fetch for all %s voices, synthesis and model probes', async (provider) => {
  forbidGlobals();
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    expect(input instanceof URL || typeof input === 'string').toBe(true);
    expect(init?.redirect).toBe('error');
    const url = String(input);
    requests.push(url);
    if (url.endsWith('/health')) return Response.json({ tts: { model: 'model', voices: ['voice'] } });
    if (url.endsWith('/models')) return Response.json({ data: [{ id: 'model' }], tts: [{ canonical_name: 'aura-2-thalia-en', name: 'thalia' }] });
    if (url.includes('/voices')) return Response.json({ voices: [{ id: 'voice', voice_id: 'voice', name: 'Voice' }], data: [{ id: 'voice', name: 'Voice' }], has_more: false });
    if (provider === 'cartesia') return new Response('data: {"type":"chunk","data":"AQI="}\n\ndata: {"type":"done"}\n\n');
    return new Response(new Uint8Array([1, 2]), { headers: {
      'content-type': 'audio/pcm', 'x-audio-encoding': 'pcm_s16le', 'x-audio-sample-rate': '24000', 'x-audio-channels': '1',
    } });
  };
  const { tts } = createAdapters({ provider, model: 'model', baseUrl, apiKey: 'secret' }, { fetch });
  const result = await checkSpeechEndpoint({ tts, signal: signal() });
  expect(result.tts?.ok).toBe(true);
  expect(result.tts?.voices).toHaveLength(1);
  expect(result.models).toEqual(['model']);
  expect(requests).toHaveLength(3);
});
