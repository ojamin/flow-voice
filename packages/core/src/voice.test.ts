import { expect, it } from 'vitest';
import {
  DEFAULT_DICTATION_PREFERENCE, SILENCE_MS, TTS_REPLY_INSTRUCTION, autoSendFor,
  normalizeDictationPreference, speechPlaybackInstruction,
} from './index.js';

it('asks for <tts> tags only while Voice is on, in one short line', () => {
  expect(TTS_REPLY_INSTRUCTION).toBe(
    'The user has turned on read-aloud: put anything you want read aloud in <tts>…</tts> tags.',
  );
  expect(speechPlaybackInstruction(true)).toBe(TTS_REPLY_INSTRUCTION);
  expect(speechPlaybackInstruction(false)).toBe('');
});

it('normalizes stored dictation choices, migrating the old single switch', () => {
  expect(normalizeDictationPreference(null)).toEqual(DEFAULT_DICTATION_PREFERENCE);
  expect(normalizeDictationPreference({ silenceMs: 5, keyword: '  over ' })).toMatchObject({
    silenceMs: SILENCE_MS.min, keyword: 'over', sendOnWord: false,
  });
  expect(normalizeDictationPreference({ silenceMs: Number.NaN }).silenceMs).toBe(SILENCE_MS.default);
  expect(normalizeDictationPreference({ enabled: true, keyword: 'over' })).toMatchObject({
    sendAfterPause: true, sendOnWord: true,
  });
  expect(normalizeDictationPreference({ enabled: true, sendAfterPause: false })).toMatchObject({
    sendAfterPause: false, sendOnWord: false,
  });
});

it('sends on a pause during a call when no send was chosen, otherwise as chosen', () => {
  const none = DEFAULT_DICTATION_PREFERENCE;
  expect(autoSendFor(none)).toEqual({ enabled: false, silenceMs: 1500, keyword: '', afterPause: false });
  expect(autoSendFor(none, { onCall: true })).toEqual({ enabled: true, silenceMs: 1500, keyword: '', afterPause: true });
  const word = { ...none, sendOnWord: true, keyword: 'over' };
  expect(autoSendFor(word, { onCall: true })).toEqual({ enabled: true, silenceMs: 1500, keyword: 'over', afterPause: false });
  expect(autoSendFor({ ...none, sendOnWord: true })).toMatchObject({ enabled: false, keyword: '' });
});
