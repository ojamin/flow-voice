import { afterEach, expect, it, vi } from 'vitest';
import { createMossCompatAdapters } from './moss-compat.js';

afterEach(() => vi.restoreAllMocks());

const health = {
  tts: { model: 'neutts-2e-q4-gguf', speakers: ['emily', 'paul'], default_voice: 'missing' },
  voxcpm2: { model: 'voxcpm2-q8_0-vulkan', voices: ['sophie', 'steven'] },
  moss_tts: {
    model: 'moss-tts-local-v1.5-q8_0-vulkan',
    voices: [{ id: 'studio-male-1', label: 'Studio male 1' }, { id: 'alice', name: 'Alice' }],
    default_voice: 'alice',
  },
};
const models = [
  { model: health.tts.model, sampleRate: 24000, channels: 1, voices: [
    { id: 'emily', name: 'emily', isDefault: true }, { id: 'paul', name: 'paul' },
  ] },
  { model: health.voxcpm2.model, sampleRate: 48000, channels: 1, voices: [
    { id: 'sophie', name: 'sophie', isDefault: true }, { id: 'steven', name: 'steven' },
  ] },
  { model: health.moss_tts.model, sampleRate: 48000, channels: 2, voices: [
    { id: 'studio-male-1', name: 'Studio male 1' }, { id: 'alice', name: 'Alice', isDefault: true },
  ] },
];
function adapter(model: string) {
  return createMossCompatAdapters({ provider: 'moss-compat', model, baseUrl: 'https://speech.example' }).tts;
}
function audioHeaders(sampleRate = 48000, channels = 2) {
  return {
    'content-type': `audio/pcm;rate=${sampleRate};channels=${channels}`,
    'x-audio-encoding': 'pcm_s16le',
    'x-audio-sample-rate': String(sampleRate),
    'x-audio-channels': String(channels),
  };
}

it.each(models)('discovers only $model voices and advertises its stream format', async ({ model, sampleRate, channels, voices }) => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json(health))
    .mockResolvedValueOnce(Response.json(health))
    .mockResolvedValueOnce(new Response(new Uint8Array(channels * 2), { headers: audioHeaders(sampleRate, channels) }));
  const tts = adapter(model);
  expect(await tts.listVoices!(new AbortController().signal)).toEqual(voices);
  expect(tts.capabilities.formats).toEqual([{ kind: 'pcm', encoding: 'pcm_s16le', sampleRate, channels }]);
  const chunks = [];
  for await (const chunk of tts.synthesize({ text: 'Hi.', format: tts.capabilities.formats[0]!, signal: new AbortController().signal })) chunks.push(chunk);
  expect(chunks).toHaveLength(1);
  expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toMatchObject({ model, voice: voices.find((voice) => 'isDefault' in voice)?.id });
});

it('uses the default MOSS model when model is empty', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(health));
  expect(await adapter('').listVoices!(new AbortController().signal)).toEqual(models[2]!.voices);
  expect(adapter('').capabilities.formats).toEqual(adapter(health.moss_tts.model).capabilities.formats);
});

it('rejects discovery for an unknown model instead of returning another engine voices', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(health));
  await expect(adapter('unknown').listVoices!(new AbortController().signal)).rejects.toMatchObject({ code: 'provider_error' });
});

it('preserves voice validation, deduplication, and the 64-entry discovery cap', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ tts: {
    model: health.tts.model,
    speakers: ['../bad', 'emily', 'emily', ...Array.from({ length: 64 }, (_, i) => `voice-${i}`)],
  } }));
  const voices = await adapter(health.tts.model).listVoices!(new AbortController().signal);
  expect(voices).toHaveLength(62);
  expect(voices[0]).toEqual({ id: 'emily', name: 'emily', isDefault: true });
  expect(voices.at(-1)?.id).toBe('voice-60');
});

it.each([
  { 'x-audio-encoding': 'pcm_f32le' },
  { 'x-audio-sample-rate': '24000' },
  { 'x-audio-channels': '1' },
  { 'content-type': 'audio/pcm;rate=24000;channels=2' },
  { 'content-type': 'audio/pcm;rate=48000;channels=1' },
  { 'content-type': 'audio/mpeg' },
])('rejects conflicting stream headers before yielding audio: %j', async (override) => {
  const cancel = vi.fn();
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4)); }, cancel });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { headers: { ...audioHeaders(), ...override } }));
  const tts = adapter('');
  const source = tts.synthesize({ text: 'Hi.', voice: 'alice', format: tts.capabilities.formats[0]!, signal: new AbortController().signal });
  await expect(source[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'provider_error' });
  expect(cancel).toHaveBeenCalledOnce();
});

it('rejects unconfirmed stream formats', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array(4), { headers: { 'content-type': 'audio/pcm' } }));
  const tts = adapter('');
  await expect(tts.synthesize({ text: 'Hi.', voice: 'alice', format: tts.capabilities.formats[0]!, signal: new AbortController().signal })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ code: 'provider_error' });
});
