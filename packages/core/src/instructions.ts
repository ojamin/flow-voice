/** A short per-message note for hosts that only add text while Voice is on. */
export const TTS_REPLY_INSTRUCTION = 'Voice is on: wrap the parts of your reply meant to be spoken in <tts>…</tts> tags.';

/** The full per-message notice for agent prompts. Send it with every message, enabled or
 * not: each notice replaces the previous one, so turning Voice off stops the tags. */
export function speechPlaybackInstruction(enabled: boolean): string {
  return enabled
    ? `<speech_playback>For this submitted message, speech playback is enabled. ${TTS_REPLY_INSTRUCTION} Wrap only short portions intended to be spoken, in complete, exact lowercase tags. Keep verbose detail, code, URLs and tables outside the tags. The client plays future closed tags automatically; Pause, Resume and Stop are local playback controls, not requests to repeat text or manage audio. This replaces any earlier speech playback notice. A later submitted message's speech notice supersedes this one.</speech_playback>`
    : `<speech_playback>For this submitted message, speech playback is disabled. Do not add <tts>…</tts> tags for automatic speech. This replaces any earlier enabled speech playback notice; respond normally. Playback controls are local, not requests to repeat text or manage audio. A later submitted message's speech notice supersedes this one.</speech_playback>`;
}
