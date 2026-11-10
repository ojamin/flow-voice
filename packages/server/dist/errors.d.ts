import type { SpeechError, SpeechErrorCode } from '@flow-voice/core';
/** Only stable codes cross the trust boundary; never copy upstream messages, bodies or URLs. */
export declare function speechError(code: SpeechErrorCode): Error & SpeechError & {
    retryable: boolean;
};
export declare function normalizeSpeechError(error: unknown): SpeechError & {
    retryable: boolean;
};
