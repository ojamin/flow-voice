import { synthesizeChunks } from './test-servers.js';
import { expect, it } from 'vitest';
import { createFakeAdapters } from './testing.js';
it('offers a deterministic first-party network-free adapter pair and abort cleanup', async () => {
  const { stt, tts } = createFakeAdapters({ transcript: 'hello' });
  const abort = new AbortController();
  const session = stt.open({
    format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    signal: abort.signal,
  });
  session.write(new Uint8Array([0, 0]));
  await session.end();
  const events = [];
  for await (const event of session.events) events.push(event);
  expect(events).toEqual([
    { type: 'partial', revision: 0, text: 'hello' },
    { type: 'final', mode: 'append', text: 'hello' },
    { type: 'ended', reason: 'stopped' },
  ]);
  expect(() => session.write(new Uint8Array([0, 0]))).toThrow();
  const chunks = [];
  for await (const chunk of synthesizeChunks(tts, {
    text: 'hello',
    format: tts.capabilities.formats[0]!,
    signal: abort.signal,
  }))
    chunks.push(chunk.audio);
  expect(chunks).toEqual([new Uint8Array([0, 0, 1, 0])]);
  const live = stt.open({
    format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    signal: abort.signal,
  });
  live.write(new Uint8Array([0, 0]));
  abort.abort();
  for await (const event of live.events)
    expect(event).toEqual({ type: 'ended', reason: 'cancelled' });
});
