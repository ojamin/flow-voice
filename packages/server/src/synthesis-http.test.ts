import { expect, it, vi } from 'vitest';
import type { SynthesisAudio } from '@flow-voice/core';
import { synthesisResponse } from './index.js';

function audio(stream: ReadableStream<Uint8Array>): SynthesisAudio {
  return { stream, mimeType: 'audio/pcm', format: { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } };
}

it('returns PCM headers and preserves the first chunk and all subsequent chunks', async () => {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
  const source = new ReadableStream<Uint8Array>({ start(controller) {
    chunks.forEach((chunk) => controller.enqueue(chunk));
    controller.close();
  } });
  const { headers, body } = await synthesisResponse(audio(source));
  expect(headers).toEqual({ 'Content-Type': 'audio/pcm', 'Cache-Control': 'no-store',
    'X-Audio-Sample-Rate': '24000', 'X-Audio-Channels': '1', 'X-Audio-Encoding': 'pcm_s16le' });
  const reader = body.getReader();
  expect((await reader.read()).value).toBe(chunks[0]);
  expect((await reader.read()).value).toBe(chunks[1]);
  expect((await reader.read()).done).toBe(true);
  expect(source.locked).toBe(false);
});

it('returns only MIME and cache headers for encoded audio, including an empty stream', async () => {
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const { headers, body } = await synthesisResponse({ stream: source, mimeType: 'audio/mpeg',
    format: { kind: 'encoded', mimeType: 'audio/mpeg' } });
  expect(headers).toEqual({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  expect((await body.getReader().read()).done).toBe(true);
  expect(source.locked).toBe(false);
});

it('rejects a lazy first-chunk failure with a safe normalized error before reading metadata', async () => {
  const source = new ReadableStream<Uint8Array>({ pull() { throw Object.assign(new Error('secret'), { status: 429 }); } }, { highWaterMark: 0 });
  const input = audio(source);
  const metadata = vi.fn(() => { throw new Error('metadata read before audio'); });
  Object.defineProperty(input, 'format', { get: metadata });
  await expect(synthesisResponse(input)).rejects.toEqual({ code: 'rate_limited', message: 'Speech provider rate limit reached.', retryable: true });
  expect(metadata).not.toHaveBeenCalled();
  expect(source.locked).toBe(false);
});

it.each([false, true])('propagates cancellation with a pending read: %s', async (pending) => {
  const cancel = vi.fn();
  const source = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel }, { highWaterMark: 0 });
  const { body } = await synthesisResponse(audio(source));
  const reader = body.getReader();
  if (pending) await reader.read();
  const read = pending ? reader.read() : undefined;
  await reader.cancel('stop');
  if (read) expect((await read).done).toBe(true);
  expect(cancel).toHaveBeenCalledExactlyOnceWith('stop');
  expect(source.locked).toBe(false);
});
