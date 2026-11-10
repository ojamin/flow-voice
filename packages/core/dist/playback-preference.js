/** Account defaults, then the user's nonempty voice, then the speaker override. */
export function resolvePlaybackPreference({ defaults, preference, override }) {
    return { ...defaults, ...(preference?.voice ? { voice: preference.voice } : {}), ...override };
}
//# sourceMappingURL=playback-preference.js.map