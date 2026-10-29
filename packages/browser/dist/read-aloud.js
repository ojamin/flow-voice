import { speechSections } from '@flow-voice/core';
/** Reads a whole message: its `<tts>` sections when it has them, otherwise all its prose
 * (code left out, links read by their label). */
export function readAloud(player, message) {
    player.enqueue({
        id: message.id,
        sections: speechSections(message.markdown),
        ...(message.voice ? { voice: message.voice } : {}),
    });
}
/** Whether Read aloud would say anything for this message. */
export function hasSpeech(markdown) {
    return speechSections(markdown).length > 0;
}
//# sourceMappingURL=read-aloud.js.map