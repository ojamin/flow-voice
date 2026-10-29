import { createAssemblyAIAdapters } from './assemblyai.js';
import { createDeepgramAdapters } from './deepgram.js';
import { createElevenLabsAdapters } from './elevenlabs.js';
import { createCartesiaAdapters } from './cartesia.js';
import { createOpenAIAdapters } from './openai.js';
import { createMossCompatAdapters } from './moss-compat.js';
/** One provider per line; unsupported kinds remain absent, never substituted. */
export declare const nativeProviderFactories: {
    openai: typeof createOpenAIAdapters;
    'moss-compat': typeof createMossCompatAdapters;
    deepgram: typeof createDeepgramAdapters;
    assemblyai: typeof createAssemblyAIAdapters;
    elevenlabs: typeof createElevenLabsAdapters;
    cartesia: typeof createCartesiaAdapters;
};
