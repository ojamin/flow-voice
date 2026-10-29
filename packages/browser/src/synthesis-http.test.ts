import { expect, it, vi } from 'vitest';
import type { AudioFormat } from '@flow-voice/core';
import { createAdapters, synthesize, synthesisResponse } from '@flow-voice/server';
import { synthesisAudioFromResponse } from './index.js';

it.each<AudioFormat>([
  { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
  { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 44100, channels: 2 },
  { kind: 'encoded', mimeType: 'audio/mpeg' },
  { kind: 'encoded', mimeType: 'audio/ogg; codecs=opus' },
])('round trips server headers and streaming bytes: %j', async (format) => {
  const mimeType = format.kind === 'pcm' ? 'audio/pcm' : format.mimeType;
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new Uint8Array([1, 2]));
    controller.close();
  } });
  const { headers, body } = await synthesisResponse({ stream, format, mimeType });
  const response = new Response(body, { headers });
  const decoded = await synthesisAudioFromResponse(response);
  expect(decoded.format).toEqual(format);
  expect(decoded.mimeType).toBe(mimeType);
  expect(decoded.stream).toBe(response.body);
  expect(new Uint8Array(await new Response(decoded.stream).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
});

it.each<Record<string, string>>([
  {},
  { 'Content-Type': 'invalid' },
  { 'Content-Type': 'audio/pcm' },
  ...['0', '-1', 'NaN', 'Infinity', '24000.5', '9007199254740992'].map((rate) => ({ 'Content-Type': 'audio/pcm', 'X-Audio-Sample-Rate': rate, 'X-Audio-Channels': '1', 'X-Audio-Encoding': 'pcm_s16le' })),
  { 'Content-Type': 'audio/pcm', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '3', 'X-Audio-Encoding': 'pcm_s16le' },
  { 'Content-Type': 'audio/pcm', 'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1', 'X-Audio-Encoding': 'float32' },
  { 'Content-Type': 'audio/mpeg', 'X-Audio-Encoding': 'pcm_s16le' },
])('cancels the body and throws a SpeechError for invalid metadata: %j', async (headers) => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  await expect(synthesisAudioFromResponse(new Response(body, { headers }))).rejects.toMatchObject({ code: 'invalid_message' });
  expect(cancel).toHaveBeenCalledOnce();
});

it('rejects a missing body', async () => {
  await expect(synthesisAudioFromResponse(new Response(null, { headers: { 'Content-Type': 'audio/mpeg' } }))).rejects.toMatchObject({ code: 'invalid_message' });
});

it('keeps the metadata error when body cancellation fails', async () => {
  const body = new ReadableStream<Uint8Array>({ cancel() { throw new Error('transport closed'); } });
  await expect(synthesisAudioFromResponse(new Response(body))).rejects.toMatchObject({ code: 'invalid_message' });
});

it.each([{ sampleRate: 22050, channels: 1 }, { sampleRate: 48000, channels: 2 }])('round trips unknown model response metadata through server and browser: %j', async ({ sampleRate, channels }) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3, 4]), { headers: {
    'content-type': `audio/pcm;rate=${sampleRate};channels=${channels}`,
    'x-audio-encoding': 'pcm_s16le',
  } }));
  try {
    const adapter = createAdapters({ provider: 'moss-compat', model: 'unknown-model', baseUrl: 'https://speech.example' }).tts!;
    const audio = await synthesize({ adapter, text: 'Hi', voice: 'voice', signal: new AbortController().signal });
    const { headers, body } = await synthesisResponse(audio);
    const decoded = await synthesisAudioFromResponse(new Response(body, { headers }));
    expect(decoded.format).toEqual({ kind: 'pcm', encoding: 'pcm_s16le', sampleRate, channels });
    expect(new Uint8Array(await new Response(decoded.stream).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  } finally { fetch.mockRestore(); }
});

it('uses the shared content-type parameter parser and rejects conflicting declarations', async () => {
  const headers = { 'content-type': 'audio/pcm;rate="22050";channels=1;encoding=pcm_s16le' };
  const audio = await synthesisAudioFromResponse(new Response(new Uint8Array(2), { headers }));
  expect(audio.format).toEqual({ kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 22050, channels: 1 });
  const cancel = vi.fn();
  await expect(synthesisAudioFromResponse(new Response(new ReadableStream({ cancel }), { headers: { ...headers, 'x-audio-sample-rate': '48000' } }))).rejects.toMatchObject({ code: 'invalid_message' });
  expect(cancel).toHaveBeenCalledOnce();
});
