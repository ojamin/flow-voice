import { expect, it, vi } from 'vitest';
import { prepareSpeechEndpoint } from './index.js';
import { createFakeAdapters } from './testing.js';

it('normalizes the draft and hands the host-resolved secret to the injected factory once', () => {
  const adapters = createFakeAdapters();
  const factory = vi.fn(() => adapters);
  expect(prepareSpeechEndpoint({ kind: 'tts', draft: { provider: 'fake', model: ' model ', baseUrl: 'https://speech.example:443/v1/', options: { voice: ' voice ' } }, apiKey: 'preserved-secret', createAdapters: factory })).toBe(adapters);
  expect(factory).toHaveBeenCalledExactlyOnceWith({ provider: 'fake', model: 'model', baseUrl: 'https://speech.example/v1', apiKey: 'preserved-secret', options: { voice: 'voice' } }, { fetch: undefined, webSocket: undefined });
});
it('rejects bad options before constructing adapters', () => {
  const factory = vi.fn(() => createFakeAdapters());
  expect(() => prepareSpeechEndpoint({ kind: 'tts', draft: { provider: 'openai', model: 'model', options: { speed: 3 } }, createAdapters: factory })).toThrow(expect.objectContaining({ code: 'invalid_message' }));
  expect(factory).not.toHaveBeenCalled();
});
it.each(['fake', 'unknown', 'assemblyai'])('rejects production fake, unknown providers and unsupported kinds: %s', (provider) => {
  expect(() => prepareSpeechEndpoint({ kind: 'tts', draft: { provider, model: 'model' } })).toThrow(expect.objectContaining({ code: 'unsupported' }));
});
