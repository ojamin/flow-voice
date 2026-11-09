import type { SpeechMessage, SpeechPlayer } from './index.js';
/** Reads a whole message: its `<tts>` sections when it has them, otherwise all its prose
 * (code left out, links read by their label). */
export declare function readAloud(player: SpeechPlayer, message: {
    id: string;
    markdown: string;
} & Pick<SpeechMessage, 'voice' | 'speed' | 'language'>): void;
/** Whether Read aloud would say anything for this message. */
export declare function hasSpeech(markdown: string): boolean;
