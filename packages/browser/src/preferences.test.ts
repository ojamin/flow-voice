import { expect, it, vi } from 'vitest';
import { createSpeechPreferences, hasSpeech, readAloud } from './index.js';
import type { SpeechPlayer } from './index.js';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

it('keeps voice and dictation choices per scope under the host keys, migrating old data', () => {
  const storage = memoryStorage({ 'app:auto-send:env-a': JSON.stringify({ enabled: true, keyword: 'over' }) });
  const preferences = createSpeechPreferences({
    storage, voiceKey: (scope) => `app:voice:${scope}`, dictationKey: (scope) => `app:auto-send:${scope}`,
  });
  const listener = vi.fn();
  preferences.subscribe(listener);
  expect(preferences.dictation('env-a')).toMatchObject({ sendAfterPause: true, sendOnWord: true, keyword: 'over' });
  expect(preferences.dictation('env-b').sendAfterPause).toBe(false);
  expect(preferences.voice('env-a')).toBeUndefined();
  preferences.setVoice('env-a', 'nova');
  preferences.setDictation('env-a', { silenceMs: 1 });
  expect(storage.data.get('app:voice:env-a')).toBe('nova');
  expect(JSON.parse(storage.data.get('app:auto-send:env-a')!).silenceMs).toBe(300);
  preferences.setVoice('env-a', '');
  expect(storage.data.has('app:voice:env-a')).toBe(false);
  expect(listener).toHaveBeenCalledTimes(3);
});

it('works without storage, or with storage that throws or holds stale data', () => {
  const broken = {
    getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem() {},
  };
  const preferences = createSpeechPreferences({ storage: broken });
  preferences.setVoice('x', 'nova');
  expect(preferences.voice('x')).toBe('nova');
  const stale = createSpeechPreferences({ storage: memoryStorage({ 'flow-voice:dictation:x': '{oops' }) });
  expect(stale.dictation('x').silenceMs).toBe(1500);
  expect(createSpeechPreferences({ storage: null }).voice('x')).toBeUndefined();
});

it('reads a whole message aloud: tagged sections, or all prose', () => {
  const enqueue = vi.fn();
  const player = { enqueue } as unknown as SpeechPlayer;
  readAloud(player, { id: 'm1', markdown: 'Intro <tts>Spoken.</tts> `code`', voice: 'nova' });
  expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1', voice: 'nova' }));
  expect(enqueue.mock.calls[0]![0].sections.map((section: { text: string }) => section.text)).toEqual(['Spoken.']);
  expect(hasSpeech('```\nonly code\n```')).toBe(false);
  expect(hasSpeech('Some prose.')).toBe(true);
});
