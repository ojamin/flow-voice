/** The per-message note while Voice is on. */
export declare const TTS_REPLY_INSTRUCTION = "The user has turned on read-aloud: put anything you want read aloud in <tts>\u2026</tts> tags.";
/** The note for a submitted message: the instruction while Voice is on, otherwise nothing.
 * Tags an agent keeps writing after Voice is off are harmless: they are unwrapped for display. */
export declare function speechPlaybackInstruction(enabled: boolean): string;
