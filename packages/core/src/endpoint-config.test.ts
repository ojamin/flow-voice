import { expect, it } from 'vitest';
import { audioFormatSchema, dictationPreferenceSchema, normalizeDictationPreference,
  resolvePlaybackPreference, speechEndpointOptionsSchema, validateSpeechEndpointDraft, voiceSchema } from './index.js';

const previous = { provider: 'openai', baseUrl: 'https://speech.example:443/v1/' };
const draft = { provider: 'openai', model: ' new-model ', baseUrl: 'https://speech.example/v1' };

it.each(['https://speech.example/v1', 'https://speech.example:443/v1/', 'https://speech.example/v1///'])('normalizes identity without rebinding the key: %s', (baseUrl) => {
  expect(validateSpeechEndpointDraft({ ...draft, baseUrl, options: { speed: 1.5 } }, previous))
    .toEqual({ ok: true, value: { ...draft, model: 'new-model', baseUrl: draft.baseUrl, options: { speed: 1.5 } } });
});

it.each([{ provider: 'deepgram' }, { baseUrl: 'https://other.example' }, { baseUrl: null }])('requires a new key for identity changes: %j', (change) => {
  expect(validateSpeechEndpointDraft({ ...draft, ...change }, previous)).toMatchObject({ ok: false, issues: [{ path: ['apiKey'] }] });
  expect(validateSpeechEndpointDraft({ ...draft, ...change, apiKey: ' new-secret ' }, previous)).toMatchObject({ ok: true, value: { apiKey: 'new-secret' } });
});

it.each(['ftp://speech.example', 'https://user:secret@speech.example', 'https://speech.example/?q=x', 'https://speech.example/#x', 'not a URL'])('rejects unsafe URL syntax: %s', (baseUrl) => {
  expect(validateSpeechEndpointDraft({ ...draft, baseUrl })).toMatchObject({ ok: false, issues: [{ path: ['baseUrl'] }] });
});

it.each([{ speed: 0.49 }, { speed: 2.01 }, { voice: ' ' }, { language: '' }, { sttTransport: 'websocket' }, { apiKey: 'secret' }, { format: { kind: 'pcm', encoding: 'pcm_s16le', channels: 3, sampleRate: 24000 } }])('rejects bad endpoint options before adapter use: %j', (options) => {
  expect(validateSpeechEndpointDraft({ ...draft, options }).ok).toBe(false);
});

it('distinguishes strict user input from tolerant stored dictation preferences', () => {
  const normalized = normalizeDictationPreference({ enabled: true, keyword: ' send ', silenceMs: -1 });
  expect(dictationPreferenceSchema.parse(normalized)).toEqual(normalized);
  expect(dictationPreferenceSchema.safeParse({ ...normalized, enabled: true }).success).toBe(false);
  expect(dictationPreferenceSchema.safeParse({ ...normalized, silenceMs: -1 }).success).toBe(false);
  expect(dictationPreferenceSchema.safeParse({ ...normalized, keyword: 'x'.repeat(41) }).success).toBe(false);
});

it('preserves generic MIME and voice ids while endpoint speed remains a settings bound', () => {
  expect(audioFormatSchema.parse({ kind: 'encoded', mimeType: 'audio/ogg; codecs=opus' })).toEqual({ kind: 'encoded', mimeType: 'audio/ogg; codecs=opus' });
  expect(voiceSchema.safeParse({ id: 'v'.repeat(200), name: 'Voice' }).success).toBe(true);
  expect(voiceSchema.safeParse({ id: 'voice', name: 'Voice', key: 'secret' }).success).toBe(false);
  expect(speechEndpointOptionsSchema.safeParse({ speed: 4 }).success).toBe(false);
});

it('matches message voice precedence without promoting unrelated user fields', () => {
  const defaults = { voice: 'account', speed: 1 };
  expect(resolvePlaybackPreference({ defaults, preference: { voice: '', speed: 2 }, override: { muted: true } })).toEqual({ ...defaults, muted: true });
  expect(resolvePlaybackPreference({ defaults, preference: { voice: 'user' }, override: { voice: 'speaker', speed: 1.5 } })).toEqual({ voice: 'speaker', speed: 1.5 });
  expect(resolvePlaybackPreference({})).toEqual({});
});
