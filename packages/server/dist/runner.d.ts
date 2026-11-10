import type { LiveTranscriptionSession, LiveTranscriptionSessionOptions } from './index.js';
/** Transport-neutral runner. Host input and output are serialized; no audio is silently dropped. */
export declare function createLiveTranscriptionSession(options: LiveTranscriptionSessionOptions): LiveTranscriptionSession;
