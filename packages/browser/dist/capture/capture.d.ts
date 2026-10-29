import type { SpeechError } from '@flow-voice/core';
import type { AudioCapture, AudioCaptureOptions } from '../index.js';
export declare function captureError(error: unknown): SpeechError;
export declare function createAudioCapture(options: AudioCaptureOptions): AudioCapture;
