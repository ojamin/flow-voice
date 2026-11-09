import type { SynthesisAudio } from '@flow-voice/core';
export declare function abortError(): DOMException;
export declare function check(signal: AbortSignal): void;
export declare function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T>;
/** Reads race cancellation even when a host stream ignores its abort signal. */
export declare function read(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array<ArrayBufferLike>>>;
export interface AudioOutput {
    unlock(): Promise<void>;
    pause(): void;
    resume(): Promise<void>;
    play(audio: SynthesisAudio, signal: AbortSignal): Promise<void>;
    reset(): void;
    /** See SpeechPlayer.setBackgroundAudio. */
    setBackground(enabled: boolean): Promise<void>;
    dispose(): void;
}
/** PCM buffers are scheduled at their native rate; AudioContext performs output-rate conversion.
 * Only 250ms is scheduled ahead. Encoded clips use one reusable audio element, bounded fallback.
 */
export declare function createAudioOutput(): AudioOutput;
