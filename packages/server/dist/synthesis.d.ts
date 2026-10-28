import type { SynthesisAudio, Voice } from '@flow-voice/core';
import type { SynthesizeOptions, VoiceListOptions } from './index.js';
export declare function synthesize(options: SynthesizeOptions): Promise<SynthesisAudio>;
export declare function listVoices(options: VoiceListOptions): Promise<readonly Voice[]>;
