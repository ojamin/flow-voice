import { afterEach, describe, expect, it } from 'vitest';
import type { AudioFormat, SttServerMessage } from '@flow-voice/core';
import {
  createAdapters,
  createLiveTranscriptionSession,
  listVoices,
  synthesize,
  normalizeSpeechError,
} from '../index.js';
import { localServer, jsonBody, deferred } from '../test-servers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
const pcm24: AudioFormat = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const pcm48: AudioFormat = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 48000, channels: 2 };
async function server(options: Parameters<typeof localServer>[0]) {
  const value = await localServer(options);
  cleanups.push(value.close);
  return value;
}

describe('native provider protocols on loopback servers', () => {
  it('MOSS trusts an explicit voice across sections without any discovery requests', async () => {
    const urls: string[] = [];
    const bodies: Record<string, unknown>[] = [];
    const upstream = await server({
      http(request, response) {
        urls.push(request.url!);
        void jsonBody(request).then((body) => {
          bodies.push(body);
          response.setHeader('content-type', 'audio/pcm');
          response.end(Buffer.from([1, 0, 2, 0]));
        });
      },
    });
    const adapter = createAdapters({
      provider: 'moss-compat',
      model: '',
      baseUrl: upstream.url,
      options: { voice: 'stale-account' },
    }).tts!;
    for (let section = 0; section < 3; section++) {
      const audio = await synthesize({
        adapter,
        text: 'hello',
        voice: 'explicit',
        format: pcm48,
        signal: new AbortController().signal,
      });
      expect(await new Response(audio.stream).arrayBuffer()).toEqual(
        new Uint8Array([1, 0, 2, 0]).buffer,
      );
    }
    expect(urls).toEqual(Array(3).fill('/v1/audio/speech/stream'));
    expect(bodies.map((body) => body.voice)).toEqual(Array(3).fill('explicit'));
  });
  it('OpenAI uses transcription intent/session.update, raw 24k base64, deltas before stop and commit final', async () => {
    const frames: unknown[] = [],
      requests: { url?: string; auth?: string }[] = [];
    const partial = deferred(),
      closed = deferred();
    const upstream = await server({
      ws(socket, request) {
        requests.push({ url: request.url, auth: request.headers.authorization });
        socket.on('close', () => closed.resolve());
        socket.on('message', (data, binary) => {
          expect(binary).toBe(false);
          const event = JSON.parse(data.toString());
          frames.push(event);
          if (event.type === 'session.update')
            socket.send(JSON.stringify({ type: 'session.updated' }));
          if (event.type === 'input_audio_buffer.append') {
            socket.send(
              JSON.stringify({
                type: 'conversation.item.input_audio_transcription.delta',
                item_id: 'one',
                delta: 'hel',
              }),
            );
            socket.send(
              JSON.stringify({
                type: 'conversation.item.input_audio_transcription.delta',
                item_id: 'one',
                delta: 'lo',
              }),
            );
          }
          if (event.type === 'input_audio_buffer.commit')
            socket.send(
              JSON.stringify({
                type: 'conversation.item.input_audio_transcription.completed',
                item_id: 'one',
                transcript: 'hello world',
              }),
            );
        });
      },
    });
    const adapters = createAdapters({
      provider: 'openai',
      model: 'gpt-live-transcribe',
      baseUrl: `${upstream.url}/custom/v1`,
      apiKey: 'test-key',
    });
    const output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: adapters.stt!,
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
        if (message.type === 'partial' && message.tentative === 'hello') partial.resolve();
      },
    });
    await runner.receive({
      type: 'start',
      version: 1,
      audio: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
      language: 'en',
    });
    await runner.receive({ type: 'audio', audio: new Uint8Array([1, 2, 3, 4]) });
    await partial.promise;
    expect(output.at(-1)).toMatchObject({ type: 'partial', tentative: 'hello' });
    await runner.receive({ type: 'stop' });
    await runner.done;
    await closed.promise;
    expect(requests).toEqual([
      { url: '/custom/v1/realtime?intent=transcription', auth: 'Bearer test-key' },
    ]);
    expect(frames).toEqual([
      {
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: { model: 'gpt-live-transcribe', languages: ['en'] },
              turn_detection: null,
            },
          },
        },
      },
      { type: 'input_audio_buffer.append', audio: 'AQIDBA==' },
      { type: 'input_audio_buffer.commit' },
    ]);
    expect(output.at(-2)).toMatchObject({ type: 'final', text: 'hello world' });
    expect(adapters.stt!.capabilities.sampleRates).toEqual([24000]);
  });
  it('OpenAI empty stop closes without an invalid empty commit', async () => {
    const frames: string[] = [];
    const upstream = await server({
      ws(socket) {
        socket.on('message', (data) => {
          const event = JSON.parse(data.toString());
          frames.push(event.type);
          if (event.type === 'session.update')
            socket.send(JSON.stringify({ type: 'session.updated' }));
        });
      },
    });
    const runner = createLiveTranscriptionSession({
      adapter: createAdapters({ provider: 'openai', model: '', baseUrl: upstream.url }).stt!,
      signal: new AbortController().signal,
      async send() {},
    });
    await runner.receive({
      type: 'start',
      version: 1,
      audio: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
    });
    await runner.receive({ type: 'stop' });
    await runner.done;
    expect(frames).toEqual(['session.update']);
  });
  it.each([
    ['hello ', 'hello world'],
    ['hel', 'hello'],
    ['hello', 'hello, world!'],
    ['a  ', 'a  b '],
    ['こ', 'こんにちは。'],
  ])(
    'MOSS preserves cumulative %j → %j including same-revision final',
    async (initial, complete) => {
      const frames: unknown[] = [],
        partial = deferred(),
        observedStart = deferred();
      let ready!: () => void;
      const upstream = await server({
        ws(socket, request) {
          expect(request.url).toBe('/v1/realtime/transcriptions');
          ready = () => socket.send(JSON.stringify({ type: 'session.ready' }));
          socket.on('message', (data, binary) => {
            if (binary) {
              frames.push([...Buffer.from(data as Buffer)]);
              socket.send(
                JSON.stringify({
                  type: 'transcript',
                  committed: initial,
                  tentative: 'wor',
                  revision: 1,
                  is_final: false,
                }),
              );
              socket.send(
                JSON.stringify({
                  type: 'transcript',
                  committed: '',
                  tentative: 'stale',
                  revision: 0,
                  is_final: false,
                }),
              );
            } else {
              const event = JSON.parse(data.toString());
              frames.push(event);
              if (event.type === 'start') observedStart.resolve();
              if (event.type === 'stop')
                socket.send(
                  JSON.stringify({
                    type: 'transcript.final',
                    committed: complete,
                    tentative: '',
                    revision: 1,
                    is_final: true,
                  }),
                );
            }
          });
        },
      });
      const output: SttServerMessage[] = [];
      const runner = createLiveTranscriptionSession({
        adapter: createAdapters({ provider: 'moss-compat', model: '', baseUrl: upstream.url }).stt!,
        signal: new AbortController().signal,
        async send(message) {
          output.push(message);
          if (message.type === 'partial' && message.tentative === 'wor') partial.resolve();
        },
      });
      await runner.receive({
        type: 'start',
        version: 1,
        audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      });
      await runner.receive({ type: 'audio', audio: new Uint8Array([1, 2]) });
      await observedStart.promise;
      expect(frames).toEqual([
        { type: 'start', encoding: 'pcm_s16le', sample_rate: 16000, att_context_right: 6 },
      ]);
      ready();
      await partial.promise;
      await runner.receive({ type: 'stop' });
      await runner.done;
      expect(frames).toEqual([
        { type: 'start', encoding: 'pcm_s16le', sample_rate: 16000, att_context_right: 6 },
        [1, 2],
        { type: 'stop' },
      ]);
      expect(output.at(-2)).toMatchObject({ type: 'final', text: complete });
      expect(JSON.stringify(output)).not.toContain('stale');
    },
  );
  it.each(['openai', 'moss-compat'])(
    '%s streams audio before HTTP end and consumer cancel closes upstream',
    async (provider) => {
      const closed = deferred(),
        body = deferred<Record<string, unknown>>();
      let responseEnded = false;
      const upstream = await server({
        http(request, response) {
          if (request.url === '/health') {
            response.setHeader('content-type', 'application/json');
            response.end(
              JSON.stringify({
                moss_tts: {
                  voices: ['alice', { voice: 'bob', display_name: 'Bob' }, '../bad', 'alice'],
                  default_voice: 'bob',
                },
              }),
            );
            return;
          }
          expect(request.url).toBe(
            provider === 'openai' ? '/audio/speech' : '/v1/audio/speech/stream',
          );
          expect(request.headers.authorization).toBe('Bearer fake-key');
          void jsonBody(request).then((value) => {
            body.resolve(value);
            response.setHeader('content-type', 'audio/pcm');
            response.write(Buffer.from([1, 0, 2, 0]));
          });
          response.on('close', () => {
            responseEnded = true;
            closed.resolve();
          });
        },
      });
      const adapter = createAdapters({
        provider,
        model: '',
        baseUrl: upstream.url,
        apiKey: 'fake-key',
      }).tts!;
      const audio = await synthesize({
        adapter,
        text: 'hello',
        format: provider === 'openai' ? pcm24 : pcm48,
        signal: new AbortController().signal,
      });
      const reader = audio.stream.getReader();
      expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([1, 0, 2, 0]) });
      expect(responseEnded).toBe(false);
      expect(await body.promise).toEqual(
        provider === 'openai'
          ? {
              model: 'gpt-4o-mini-tts',
              input: 'hello',
              voice: 'alloy',
              response_format: 'pcm',
              stream_format: 'audio',
            }
          : {
              model: 'moss-tts-local-v1.5-q8_0-vulkan',
              input: 'hello',
              voice: 'bob',
              emotion: 'neutral',
              temperature: 1,
            },
      );
      await reader.cancel();
      await closed.promise;
      if (provider === 'moss-compat')
        expect(await listVoices({ adapter, signal: new AbortController().signal })).toEqual([
          { id: 'alice', name: 'alice' },
          { id: 'bob', name: 'Bob', isDefault: true },
        ]);
    },
  );
  it.each([
    ['audio/mpeg', 'mp3'],
    ['audio/ogg; codecs=opus', 'opus'],
  ])('OpenAI preserves encoded %s stream and fixed voices', async (mimeType, responseFormat) => {
    const body = deferred<Record<string, unknown>>();
    const upstream = await server({
      http(request, response) {
        void jsonBody(request).then((value) => {
          body.resolve(value);
          response.end(Buffer.from([1, 2, 3]));
        });
      },
    });
    const adapter = createAdapters({
      provider: 'openai',
      model: 'test-tts',
      baseUrl: upstream.url,
    }).tts!;
    const audio = await synthesize({
      adapter,
      text: 'hello',
      voice: 'coral',
      speed: 1.5,
      format: { kind: 'encoded', mimeType },
      signal: new AbortController().signal,
    });
    expect(await new Response(audio.stream).arrayBuffer()).toEqual(
      new Uint8Array([1, 2, 3]).buffer,
    );
    expect(await body.promise).toMatchObject({
      response_format: responseFormat,
      speed: 1.5,
      voice: 'coral',
      model: 'test-tts',
    });
    expect(
      (await listVoices({ adapter, signal: new AbortController().signal })).map(
        (voice) => voice.id,
      ),
    ).toContain('cedar');
  });
  it.each([401, 429, 503])('redacts HTTP %i responses', async (status) => {
    const upstream = await server({
      http(_request, response) {
        response.writeHead(status).end('secret provider response');
      },
    });
    const adapter = createAdapters({
      provider: 'openai',
      model: 'tts',
      baseUrl: upstream.url,
    }).tts!;
    const audio = await synthesize({
      adapter,
      text: 'hello',
      format: pcm24,
      signal: new AbortController().signal,
    });
    await expect(audio.stream.getReader().read()).rejects.toMatchObject({
      code: status === 401 ? 'unauthorized' : status === 429 ? 'rate_limited' : 'provider_error',
    });
  });
  it('MOSS rejects malformed PCM alignment after delivering incremental bytes', async () => {
    const upstream = await server({
      http(request, response) {
        if (request.url === '/health')
          response.end(JSON.stringify({ moss_tts: { voices: ['alice'] } }));
        else {
          response.setHeader('content-type', 'audio/pcm');
          response.end(Buffer.from([1, 2, 3]));
        }
      },
    });
    const adapter = createAdapters({
      provider: 'moss-compat',
      model: '',
      baseUrl: upstream.url,
    }).tts!;
    const audio = await synthesize({
      adapter,
      text: 'hello',
      format: pcm48,
      signal: new AbortController().signal,
    });
    const reader = audio.stream.getReader();
    expect((await reader.read()).value).toHaveLength(3);
    await expect(reader.read()).rejects.toMatchObject({ code: 'provider_error' });
  });
  it('WS abort closes socket and errors are redacted', async () => {
    const closed = deferred();
    const upstream = await server({
      ws(socket) {
        socket.on('close', () => closed.resolve());
        socket.on('message', () =>
          socket.send(JSON.stringify({ type: 'error', message: 'secret URL', code: 'upstream' })),
        );
      },
    });
    const session = createAdapters({
      provider: 'moss-compat',
      model: '',
      baseUrl: upstream.url,
    }).stt!.open({
      format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      signal: new AbortController().signal,
    });
    const events = [];
    for await (const event of session.events) events.push(event);
    await closed.promise;
    expect(events).toEqual([
      { type: 'error', ...normalizeSpeechError(new Error('secret URL')) },
      { type: 'ended', reason: 'error' },
    ]);
  });
  it('WS pre-ready admission caps frames and abort closes iterator without lingering resources', async () => {
    const connected = deferred();
    const upstream = await server({
      ws(socket) {
        connected.resolve();
        socket.on('message', () => {});
      },
    });
    const controller = new AbortController();
    const session = createAdapters({
      provider: 'openai',
      model: '',
      baseUrl: upstream.url,
    }).stt!.open({
      format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
      signal: controller.signal,
    });
    for (let i = 0; i < 64; i++) session.write(new Uint8Array(2));
    expect(() => session.write(new Uint8Array(2))).toThrow('limit');
    await connected.promise;
    controller.abort();
    const events = [];
    for await (const event of session.events) events.push(event);
    expect(events.at(-1)).toEqual({ type: 'ended', reason: 'cancelled' });
    await session.end();
  });
  it('iterator return before the first pull still closes an acquired socket', async () => {
    const connected = deferred(),
      closed = deferred();
    const upstream = await server({
      ws(socket) {
        connected.resolve();
        socket.on('close', () => closed.resolve());
      },
    });
    const session = createAdapters({
      provider: 'moss-compat',
      model: '',
      baseUrl: upstream.url,
    }).stt!.open({
      format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      signal: new AbortController().signal,
    });
    await connected.promise;
    await session.events[Symbol.asyncIterator]().return?.();
    await closed.promise;
    await session.end();
  });
  it('rejects unknown providers, fake and credential-bearing endpoints without network', () => {
    for (const provider of ['fake', 'missing', '__proto__'])
      expect(() => createAdapters({ provider, model: '' })).toThrow('supported');
    expect(() =>
      createAdapters({
        provider: 'openai',
        model: '',
        baseUrl: 'https://secret:password@example.test',
      }),
    ).toThrow('Invalid');
    expect(() => createAdapters({ provider: 'moss-compat', model: '' })).toThrow('configured');
  });
});
