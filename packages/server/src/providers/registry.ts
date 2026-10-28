import { createAssemblyAIAdapters } from './assemblyai.js';
import { createDeepgramAdapters } from './deepgram.js';
import { createElevenLabsAdapters } from './elevenlabs.js';
import { createCartesiaAdapters } from './cartesia.js';
import { createOpenAIAdapters } from './openai.js';
import { createMossCompatAdapters } from './moss-compat.js';

/** One provider per line; unsupported kinds remain absent, never substituted. */
export const nativeProviderFactories = {
  openai: createOpenAIAdapters,
  'moss-compat': createMossCompatAdapters,
  deepgram: createDeepgramAdapters,
  assemblyai: createAssemblyAIAdapters,
  elevenlabs: createElevenLabsAdapters,
  cartesia: createCartesiaAdapters,
};
