import { expect, it } from 'vitest';
import { createAssemblyAIAdapters } from './assemblyai.js';
import { createCartesiaAdapters } from './cartesia.js';
import { createDeepgramAdapters } from './deepgram.js';
import { createElevenLabsAdapters } from './elevenlabs.js';
import { nativeProviderFactories } from './registry.js';
import { createOpenAIAdapters } from './openai.js';
import { createMossCompatAdapters } from './moss-compat.js';
import { createAdapters } from '../registry.js';

it('registers all native provider factories together', () => {
  expect(nativeProviderFactories).toEqual({
    openai: createOpenAIAdapters,
    'moss-compat': createMossCompatAdapters,
    deepgram: createDeepgramAdapters,
    assemblyai: createAssemblyAIAdapters,
    elevenlabs: createElevenLabsAdapters,
    cartesia: createCartesiaAdapters,
  });
});

it.each(Object.keys(nativeProviderFactories))(
  'resolves %s through the public registry',
  (provider) => {
    const adapters = createAdapters({
      provider,
      model: 'fixture-model',
      apiKey: 'fixture-key',
      baseUrl: 'https://speech.example.test',
    });
    expect(adapters.stt || adapters.tts).toBeTruthy();
  },
);
