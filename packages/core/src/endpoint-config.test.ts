import { expect, it } from 'vitest';
import { audioFormatSchema, dictationPreferenceSchema, normalizeDictationPreference,
  resolvePlaybackPreference, speechEndpointOptionsSchema, validateSpeechEndpointDraft, voiceSchema, isLocalSpeechEndpoint } from './index.js';

const previous = { provider: 'openai', baseUrl: 'https://speech.example:443/v1/' };
const draft = { provider: 'openai', model: ' new-model ', baseUrl: 'https://speech.example/v1' };

it.each<[object, string[], string]>([
  [{ provider: ' ' }, ['provider'], 'Choose a provider.'],
  [{ model: ' ' }, ['model'], 'Enter a model.'],
  ...[0, 0.49, 2.01, NaN, Infinity].map((speed): [object, string[], string] => [
    { options: { speed } }, ['options', 'speed'], 'Speed must be between 0.5 and 2.',
  ]),
])('returns friendly canonical field issues: %j', (change, path, message) => {
  expect(validateSpeechEndpointDraft({ ...draft, ...change })).toMatchObject({ ok: false, issues: expect.arrayContaining([{ path, message }]) });
});

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

it.each(['https://speech.example', 'https://speech.example/v2', 'https://speech.example:443/nested/path'])('preserves the saved key for same-origin path edits: %s', (baseUrl) => {
  expect(validateSpeechEndpointDraft({ ...draft, baseUrl }, previous)).toMatchObject({ ok: true });
});

it.each(['http://speech.example/v1', 'https://speech.example:444/v1', 'http://127.0.0.1:3100/v1'])('never inherits a saved key across origins, even onto a local server: %s', (baseUrl) => {
  expect(validateSpeechEndpointDraft({ ...draft, baseUrl }, previous)).toMatchObject({ ok: false, issues: [{ path: ['apiKey'] }] });
});

it.each(['localhost', '127.0.0.1', '127.255.255.254', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.255.254', '[::1]'])('accepts absent or empty local keys without placeholders: %s', (host) => {
  const baseUrl = `http://${host}:3100/v1`;
  expect(isLocalSpeechEndpoint(baseUrl)).toBe(true);
  for (const apiKey of [undefined, '', '  ']) {
    expect(validateSpeechEndpointDraft({ ...draft, baseUrl, apiKey })).toMatchObject({ ok: true, value: { baseUrl } });
  }
});

it.each(['172.15.255.255', '172.32.0.1', '192.169.0.1', '11.0.0.1', 'localhost.example', 'example.com', '[::2]'])('does not treat public or lookalike hosts as local: %s', (host) => {
  const baseUrl = `http://${host}`;
  expect(isLocalSpeechEndpoint(baseUrl)).toBe(false);
  expect(validateSpeechEndpointDraft({ ...draft, baseUrl, apiKey: '' })).toMatchObject({ ok: false });
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
