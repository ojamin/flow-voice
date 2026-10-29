import { describe, expect, it } from 'vitest';
import { createAdapters, listVoices, resolveVoice, synthesize, type TtsAdapter } from './index.js';
import { createFakeAdapters } from './testing.js';
import { deferred } from './test-servers.js';
import { requestedSynthesis } from './audio-stream.js';
const format = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 } as const;
describe('synthesis boundary', () => {
  it.each(['openai', 'elevenlabs', 'cartesia', 'deepgram'])('request-selected %s returns its default or explicit format', async (provider) => {
    const adapter = createAdapters({ provider, model: 'model' }).tts!;
    const request = { text: 'Hi', signal: new AbortController().signal };
    const defaultAudio = await adapter.synthesize(request);
    expect(defaultAudio.format).toEqual(adapter.capabilities.formats[0]);
    await defaultAudio.stream.cancel();
    const selected = adapter.capabilities.formats.at(-1)!;
    const selectedAudio = await adapter.synthesize({ ...request, format: selected });
    expect(selectedAudio.format).toEqual(selected);
    await selectedAudio.stream.cancel();
  });
  it('returns response-reported audio unchanged without request-format labelling or equality gates', async () => {
    const audio = { format: { ...format, sampleRate: 22050 }, mimeType: 'audio/pcm', stream: new ReadableStream<Uint8Array>() };
    const adapter: TtsAdapter = { ...createFakeAdapters().tts,
      capabilities: { ...createFakeAdapters().tts.capabilities, formats: [] },
      async synthesize() { return audio; },
    };
    expect(await synthesize({ adapter, text: 'Hi', format, signal: new AbortController().signal })).toBe(audio);
    await audio.stream.cancel();
  });
  it('request-selected adapters default to the first format and reject unsupported requests', async () => {
    const adapter = createFakeAdapters().tts;
    const audio = await synthesize({ adapter, text: 'Hi', signal: new AbortController().signal });
    expect(audio.format).toEqual(adapter.capabilities.formats[0]);
    await audio.stream.cancel();
    await expect(synthesize({ adapter, text: 'Hi', format: { ...format, sampleRate: 8000 }, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'unsupported' });
  });
  it('resolves requested, configured, default, first, then empty-catalog passthrough', () => {
    const voices = [{ id: 'first', name: 'First' }, { id: 'default', name: 'Default', isDefault: true }, { id: 'configured', name: 'Configured' }];
    expect(resolveVoice({ voices, requested: 'first', configured: 'configured' })).toBe('first');
    expect(resolveVoice({ voices, requested: 'stale', configured: 'configured' })).toBe('configured');
    expect(resolveVoice({ voices, requested: 'stale', configured: 'stale' })).toBe('default');
    expect(resolveVoice({ voices: voices.filter((voice) => !voice.isDefault) })).toBe('first');
    expect(resolveVoice({ voices: [], requested: 'custom', configured: 'configured' })).toBe('custom');
    expect(resolveVoice({ voices: [], configured: 'configured' })).toBe('configured');
    expect(resolveVoice({ voices: [] })).toBeUndefined();
  });
  it('validates semantic text cap and speed before calling provider', async () => {
    let calls = 0;
    const adapter: TtsAdapter = {
      ...createFakeAdapters().tts,
      synthesize: requestedSynthesis(async function* () {
        calls++;
        yield { audio: new Uint8Array(2) };
      }),
    };
    for (const input of [
      { text: ' ' },
      { text: 'a'.repeat(4001) },
      { text: 'hi', speed: NaN },
    ]) {
      await expect(
        synthesize({ adapter, format, signal: new AbortController().signal, ...input }),
      ).rejects.toMatchObject({ code: expect.any(String) });
    }
    expect(calls).toBe(0);
  });
  it('is demand driven and cancellation aborts a pending upstream read before iterator return', async () => {
    let calls = 0,
      cleaned = false;
    const entered = deferred();
    const adapter: TtsAdapter = {
      ...createFakeAdapters().tts,
      synthesize: requestedSynthesis(async function* ({ signal }) {
        calls++;
        try {
          entered.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          yield { audio: new Uint8Array(2) };
        } finally {
          cleaned = true;
        }
      }),
    };
    const audio = await synthesize({
      adapter,
      text: 'hi',
      format,
      signal: new AbortController().signal,
    });
    expect(calls).toBe(0);
    const reader = audio.stream.getReader();
    const reading = reader.read();
    await entered.promise;
    await reader.cancel();
    await reading;
    expect(cleaned).toBe(true);
  });
  it('external abort errors pending reads and removes upstream resources', async () => {
    const entered = deferred();
    let cleaned = false;
    const adapter: TtsAdapter = {
      ...createFakeAdapters().tts,
      synthesize: requestedSynthesis(async function* ({ signal }) {
        try {
          entered.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          yield { audio: new Uint8Array(2) };
        } finally {
          cleaned = true;
        }
      }),
    };
    const controller = new AbortController();
    const audio = await synthesize({ adapter, text: 'hi', format, signal: controller.signal });
    const reading = audio.stream.getReader().read();
    await entered.promise;
    controller.abort();
    await expect(reading).rejects.toMatchObject({ code: 'cancelled' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cleaned).toBe(true);
  });
  it('lists no voices for none, rejects missing list implementation and redacts failures', async () => {
    const base = createFakeAdapters().tts;
    expect(
      await listVoices({
        adapter: {
          ...base,
          listVoices: undefined,
          capabilities: { ...base.capabilities, voices: 'none' },
        },
        signal: new AbortController().signal,
      }),
    ).toEqual([]);
    await expect(
      listVoices({
        adapter: { ...base, listVoices: undefined },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'unsupported' });
    await expect(
      listVoices({
        adapter: {
          ...base,
          async listVoices() {
            throw new Error('secret');
          },
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toEqual({
      code: 'provider_error',
      message: 'Speech provider failed.',
      retryable: true,
    });
  });
});
