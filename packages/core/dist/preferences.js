export const SILENCE_MS = { default: 1500, min: 300, max: 60_000 };
export const DEFAULT_DICTATION_PREFERENCE = Object.freeze({
    sendAfterPause: false,
    silenceMs: SILENCE_MS.default,
    sendOnWord: false,
    keyword: '',
    stopAfterSend: false,
});
/** Accepts stored or partial input and returns a complete, valid preference. An older
 * `enabled` flag (one switch for both sends) migrates to both sends when they are unset. */
export function normalizeDictationPreference(value) {
    const input = value && typeof value === 'object' ? value : {};
    const legacy = input.enabled === true;
    const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
    const silenceMs = typeof input.silenceMs === 'number' && Number.isFinite(input.silenceMs)
        ? Math.round(Math.min(SILENCE_MS.max, Math.max(SILENCE_MS.min, input.silenceMs)))
        : SILENCE_MS.default;
    return {
        sendAfterPause: typeof input.sendAfterPause === 'boolean' ? input.sendAfterPause : legacy,
        silenceMs,
        sendOnWord: typeof input.sendOnWord === 'boolean' ? input.sendOnWord : legacy && keyword !== '',
        keyword,
        stopAfterSend: input.stopAfterSend === true,
    };
}
/** The dictation controller's `autoSend` for a preference. On a call, a pause sends when the
 * user chose neither send, so a hands-free conversation always sends on its own. */
export function autoSendFor(preference, { onCall = false } = {}) {
    const word = preference.sendOnWord && preference.keyword !== '';
    const afterPause = preference.sendAfterPause || (onCall && !word);
    return {
        enabled: afterPause || word,
        silenceMs: preference.silenceMs,
        keyword: word ? preference.keyword : '',
        afterPause,
    };
}
//# sourceMappingURL=preferences.js.map