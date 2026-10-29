/** A short per-message note for hosts that only add text while Voice is on. */
export declare const TTS_REPLY_INSTRUCTION = "Voice is on: wrap the parts of your reply meant to be spoken in <tts>\u2026</tts> tags.";
/** The full per-message notice for agent prompts. Send it with every message, enabled or
 * not: each notice replaces the previous one, so turning Voice off stops the tags. */
export declare function speechPlaybackInstruction(enabled: boolean): string;
