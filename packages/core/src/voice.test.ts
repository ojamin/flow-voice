import { expect, it } from 'vitest';
import {
  DEFAULT_DICTATION_PREFERENCE, SILENCE_MS, TTS_REPLY_INSTRUCTION, autoSendFor,
  normalizeDictationPreference, speechPlaybackInstruction,
} from './index.js';

it('exports the short lowercase per-message Voice instruction', () => {
  expect(TTS_REPLY_INSTRUCTION).toBe('Voice is on: wrap the parts of your reply meant to be spoken in <tts>…</tts> tags.');
});

it('gives a full enabled/disabled playback notice, each replacing the last', () => {
  const on = speechPlaybackInstruction(true);
  expect(on).toContain(TTS_REPLY_INSTRUCTION);
  expect(on).toMatch(/^<speech_playback>.*supersedes this one\.<\/speech_playback>$/s);
  expect(speechPlaybackInstruction(false)).toContain('speech playback is disabled. Do not add <tts>…</tts> tags');
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
