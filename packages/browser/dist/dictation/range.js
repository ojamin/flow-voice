/** The single contiguous edit inferred by plain-text controls. Rich ports supply exact edits. */
export function textEdit(previous, next) {
    let start = 0;
    while (start < previous.length && start < next.length && previous[start] === next[start])
        start++;
    let end = previous.length;
    let right = next.length;
    while (end > start && right > start && previous[end - 1] === next[right - 1]) {
        end--;
        right--;
    }
    return { start, end, insertedLength: right - start };
}
/** Editing owned words hands them to the author; only later transcript words remain ours. */
export function mapOwnedRange(start, end, edit) {
    const delta = edit.insertedLength - (edit.end - edit.start);
    if (edit.end <= start && edit.start < start) {
        return { start: start + delta, end: end + delta, touched: false };
    }
    if (edit.start < end || edit.start === start) {
        const at = Math.max(edit.start + edit.insertedLength, end + delta);
        return { start: at, end: at, touched: true };
    }
    return { start, end, touched: false };
}
//# sourceMappingURL=range.js.map