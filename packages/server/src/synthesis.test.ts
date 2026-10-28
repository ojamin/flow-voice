import { describe, expect, it } from 'vitest';
import { listVoices, synthesize, type TtsAdapter } from './index.js';
import { createFakeAdapters } from './testing.js';
import { deferred } from './test-servers.js';
const format = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 } as const;
describe('synthesis boundary', () => {
  it('validates semantic text cap, format and speed before calling provider', async () => {
    let calls = 0;
    const adapter: TtsAdapter = {
      ...createFakeAdapters().tts,
      async *synthesize() {
        calls++;
        yield { audio: new Uint8Array(2) };
      },
    };
    for (const input of [
      { text: ' ' },
      { text: 'a'.repeat(4001) },
      { text: 'hi', speed: NaN },
      {
        text: 'hi',
        format: { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 8000, channels: 1 } as const,
      },
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
      async *synthesize({ signal }) {
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
      },
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
      async *synthesize({ signal }) {
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
      },
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
