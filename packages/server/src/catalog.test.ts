import { describe, expect, it, vi } from 'vitest';
import { createVoiceCatalog } from './index.js';
import type { TtsAdapter } from './index.js';

function adapter(names: string[][]) {
  const listVoices = vi.fn(async () => names.shift()!.map((id) => ({ id, name: id })));
  return { listVoices, capabilities: { voices: 'list' } } as unknown as TtsAdapter & { listVoices: typeof listVoices };
}

describe('voice catalog', () => {
  it('reuses a fresh list, refreshes when stale or asked, and keeps endpoints apart', async () => {
    let clock = 0;
    const catalog = createVoiceCatalog({ ttlMs: 1000, now: () => clock });
    const tts = adapter([['a'], ['b'], ['c']]);
    const signal = new AbortController().signal;
    expect((await catalog.get('one', tts, signal)).map((v) => v.id)).toEqual(['a']);
    clock = 999;
    expect((await catalog.get('one', tts, signal)).map((v) => v.id)).toEqual(['a']);
    clock = 1000;
    expect((await catalog.get('one', tts, signal)).map((v) => v.id)).toEqual(['b']);
    expect((await catalog.refresh('one', tts, signal)).map((v) => v.id)).toEqual(['c']);
    expect(tts.listVoices).toHaveBeenCalledTimes(3);
    const other = adapter([['z']]);
    expect((await catalog.get('two', other, signal)).map((v) => v.id)).toEqual(['z']);
  });
});
