import type { SynthesisAudio } from '@flow-voice/core';
/** One media element for the whole player. MSE is used only for browser-advertised MIME types. */
export declare function playEncoded(media: HTMLAudioElement, audio: SynthesisAudio, signal: AbortSignal, isPaused: () => boolean): Promise<void>;
