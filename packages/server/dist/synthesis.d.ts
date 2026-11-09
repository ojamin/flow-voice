import type { SynthesisAudio, Voice } from '@flow-voice/core';
import type { SynthesizeOptions, VoiceListOptions } from './index.js';
/** Select within a catalog; an unavailable/empty catalog permits host-supplied ids. */
export declare function resolveVoice({ voices, requested, configured, }: {
    voices: readonly Voice[];
    requested?: string;
    configured?: string;
}): string | undefined;
export declare function synthesize(options: SynthesizeOptions): Promise<SynthesisAudio>;
export declare function listVoices(options: VoiceListOptions): Promise<readonly Voice[]>;
