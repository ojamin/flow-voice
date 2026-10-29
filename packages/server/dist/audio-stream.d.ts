import type { AudioFormat, SynthesisAudio, SynthesisRequest } from '@flow-voice/core';
import type { AudioChunk, TtsAdapter } from './index.js';
/** Own the response reader immediately, so abort before the first pull cancels it too. */
export declare function audioFromResponse(response: Response, format: AudioFormat, signal: AbortSignal): SynthesisAudio;
/** Adapt request-selected provider protocols without buffering their audio. */
export declare function requestedSynthesis(generate: (request: SynthesisRequest & {
    format: AudioFormat;
    signal: AbortSignal;
}) => AsyncIterable<AudioChunk>): TtsAdapter['synthesize'];
export declare function audioFromChunks(generate: (signal: AbortSignal) => AsyncIterable<AudioChunk>, format: AudioFormat, signal: AbortSignal, validateFrames?: boolean): SynthesisAudio;
