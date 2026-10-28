export interface TtsSpan {
    start: number;
    end: number;
    contentStart: number;
    contentEnd: number;
    text: string;
}
export interface TtsParseResult {
    spans: readonly TtsSpan[];
    malformed: boolean;
}
/** Exact <tts> grammar, case-sensitive. Nested, unmatched or malformed tts
 * tags reject the whole document's tag interpretation: display remains literal markdown. */
export declare function parseTts(source: string): TtsParseResult;
export declare function displayMarkdown(source: string): string;
/** Speech excludes code, images, HTML blocks and tables; link labels and emoji remain. */
export declare function markdownToSpeech(source: string): string;
export interface SpeechSection {
    ordinal: number;
    text: string;
}
export interface SpeechSectionOptions {
    maxTextChars?: number;
    maxSectionChars?: number;
}
export declare function speechSections(source: string, options?: SpeechSectionOptions): SpeechSection[];
export declare function speechText(source: string, options?: SpeechSectionOptions): string;
/** One extractor per message. push returns only newly completed sections. Source must grow
 * append-only; replacement throws so hosts can invalidate rather than replay. Untagged prose
 * waits for final=true. Completed tagged sections can play before the message is final.
 * A later malformed suffix cannot retract audio already spoken; hosts must stop on malformed. */
export interface StreamingSpeechExtractor {
    push(source: string, final?: boolean): SpeechSection[];
    readonly malformed: boolean;
}
export declare function createStreamingSpeechExtractor(options?: SpeechSectionOptions): StreamingSpeechExtractor;
