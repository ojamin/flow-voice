/** The per-message note while Voice is on. */
export const TTS_REPLY_INSTRUCTION = 'The user has turned on read-aloud: put anything you want read aloud in <tts>…</tts> tags.';
/** The note for a submitted message: the instruction while Voice is on, otherwise nothing.
 * Tags an agent keeps writing after Voice is off are harmless: they are unwrapped for display. */
export function speechPlaybackInstruction(enabled) {
    return enabled ? TTS_REPLY_INSTRUCTION : '';
}
//# sourceMappingURL=instructions.js.map