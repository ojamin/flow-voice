import type { SynthesisAudio } from '@flow-voice/core';
/** Await the first chunk before the host commits headers, without buffering the audio. */
export declare function synthesisResponse(audio: SynthesisAudio): Promise<{
    headers: Record<string, string>;
    body: ReadableStream<Uint8Array>;
}>;
