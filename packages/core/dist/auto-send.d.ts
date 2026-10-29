/** Unicode/case/whitespace normalisation only; punctuation inside a phrase remains meaningful. */
export declare function normalizeKeyword(value: string): string;
/** A keyword must occupy whole trailing words. Trailing sentence punctuation is ignored.
 * Returns the original (not normalised) draft with only the matched suffix removed. */
export declare function matchSendKeyword(text: string, keyword: string): {
    matched: boolean;
    text: string;
};
export declare function stripSendKeyword(text: string, keyword: string): string;
export interface SilenceInput {
    enabled: boolean;
    text: string;
    now: number;
    lastWordAt: number;
    silenceMs: number;
    cancelled: boolean;
    canSubmit: boolean;
}
/** No timers or side effects. Hosts reset lastWordAt on words (not quiet audio frames), and own once-only submission. */
export declare function silenceDecision(input: SilenceInput): {
    send: boolean;
    remainingMs: number | null;
};
