import type { SynthesisAudio } from '@flow-voice/core';
/** Decode a successful synthesis response. Hosts handle HTTP error responses themselves. */
export declare function synthesisAudioFromResponse(response: Response): Promise<SynthesisAudio>;
