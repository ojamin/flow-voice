/** Unicode/case/whitespace normalisation only; punctuation inside a phrase remains meaningful. */
export function normalizeKeyword(value) {
    return value.normalize('NFKC').toLocaleLowerCase('en-US').trim().replace(/\s+/gu, ' ');
}
/** A keyword must occupy whole trailing words. Trailing sentence punctuation is ignored.
 * Returns the original (not normalised) draft with only the matched suffix removed. */
export function matchSendKeyword(text, keyword) {
    const phrase = normalizeKeyword(keyword);
    if (!phrase)
        return { matched: false, text };
    const candidate = text.replace(/[.!?,;:。！？]+\s*$/u, '').trimEnd();
    for (let i = 0; i < candidate.length; i++) {
        if (i > 0 && !/\s/u.test(candidate[i - 1]))
            continue;
        if (normalizeKeyword(candidate.slice(i)) === phrase)
            return { matched: true, text: candidate.slice(0, i).trimEnd() };
    }
    return { matched: false, text };
}
export function stripSendKeyword(text, keyword) {
    return matchSendKeyword(text, keyword).text;
}
/** No timers or side effects. Hosts reset lastWordAt on words (not quiet audio frames), and own once-only submission. */
export function silenceDecision(input) {
    if (!input.enabled || input.cancelled || !input.canSubmit || !input.text.trim())
        return { send: false, remainingMs: null };
    const remainingMs = Math.max(0, input.silenceMs - Math.max(0, input.now - input.lastWordAt));
    return { send: remainingMs === 0, remainingMs };
}
//# sourceMappingURL=auto-send.js.map