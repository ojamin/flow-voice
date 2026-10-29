import { mapOwnedRange, textEdit } from './range.js';
import { submitWithBinding } from './submission.js';
/** A character that starts a word, so dictated words right before it need a separating space. */
const STARTS_WORD = /[^\s.,!?;:)\]}]/;
/** Separate dictated words from the draft text around the owned range. */
function spaced(words, before, after) {
    let text = before === undefined || /\s/.test(before) ? words.trimStart() : words;
    if (!text)
        return '';
    if (before !== undefined && !/\s/.test(before) && !/^\s/.test(text))
        text = ` ${text}`;
    if (after !== undefined && STARTS_WORD.test(after) && !/\s$/.test(text))
        text = `${text} `;
    return text;
}
/** The textarea adapter's contract over a revisioned rich editor: one insertion transaction
 * per dictation, captured at `begin`, never the latest caret. User edits inside dictated text
 * make that text theirs; only later words are written. */
export function createEditorComposerAdapter(port) {
    let binding;
    let active = false;
    let owner = '';
    let start = 0;
    let end = 0;
    /** The draft text as dictation last left it, to tell user edits from its own writes. */
    let expected = '';
    let selected = '';
    let transcript = '';
    let committed = '';
    /** Transcript prefix the user edited into, now theirs: only later words are rendered. */
    let frozen = 0;
    let disposed = false;
    let tentative = '';
    // The normal send may synchronously clear the draft before its promise resolves.
    let sending = false;
    let selectionEdited = false;
    const clearTentative = () => {
        tentative = '';
        port.setTentative?.(null);
    };
    const stop = () => {
        active = false;
        clearTentative();
    };
    const invalidate = () => {
        stop();
        const current = binding;
        binding = undefined;
        current?.invalidate();
    };
    /** The current draft, with the owned range moved past any edits made since the last write. */
    const sync = (change) => {
        const draft = port.readDraft();
        if (disposed || change?.replaced || !draft || draft.ownerKey !== owner) {
            invalidate();
            return null;
        }
        const next = draft.text;
        if (change || next !== expected) {
            for (const edit of change?.edits ?? [textEdit(expected, next)]) {
                const mapped = mapOwnedRange(start, end, edit);
                if (mapped.touched) {
                    // An edit inside dictated text hands that text to the user; keep only future words.
                    frozen = transcript.length;
                    selectionEdited = Boolean(port.setTentative);
                }
                start = mapped.start;
                end = mapped.end;
            }
            expected = next;
        }
        return draft;
    };
    const write = (replacementFor) => {
        const draft = sync();
        if (!draft)
            return;
        const replacement = replacementFor(draft);
        const oldEnd = end;
        if (draft.text.slice(start, oldEnd) === replacement)
            return;
        const newEnd = start + replacement.length;
        // A caret after the insertion follows it; one before it stays put.
        const caret = draft.selection.end;
        const cursor = caret >= oldEnd ? caret + newEnd - oldEnd : Math.min(caret, newEnd);
        if (!port.replace(draft, start, oldEnd, replacement, cursor)) {
            invalidate();
            return;
        }
        expected = draft.text.slice(0, start) + replacement + draft.text.slice(oldEnd);
        end = newEnd;
    };
    const render = (text) => {
        if (!active)
            return;
        // `frozen` is only known after `sync` has seen the user's latest edits.
        write((draft) => spaced(text.slice(Math.min(frozen, text.length)), draft.text[start - 1], draft.text[end]));
        transcript = text;
    };
    const restoreSelection = () => {
        if (active && !selectionEdited)
            write(() => selected);
    };
    const showTentative = () => {
        const draft = port.readDraft();
        port.setTentative?.(active && draft && tentative
            ? { draft, at: end, text: spaced(tentative, draft.text[end - 1], draft.text[end]) }
            : null);
    };
    const unsubscribe = port.subscribeDraftChanges((change) => {
        if (active) {
            sync(change);
            showTentative();
        }
        else if (!sending && binding && (change?.replaced || port.readDraft()?.ownerKey !== owner))
            invalidate();
    });
    return {
        begin() {
            if (disposed)
                return;
            const draft = port.readDraft();
            active = draft !== null;
            if (!draft)
                return;
            owner = draft.ownerKey;
            start = draft.selection.start;
            end = draft.selection.end;
            expected = draft.text;
            selected = draft.text.slice(start, end);
            transcript = committed = '';
            frozen = 0;
            selectionEdited = false;
        },
        update(value) {
            if (!active || !sync())
                return;
            committed = value.committed;
            if (port.setTentative) {
                tentative = value.tentative;
                // An interim hypothesis must not remove the author's selected text.
                if (committed || transcript)
                    render(committed);
                showTentative();
            }
            else
                render([value.committed, value.tentative].filter(Boolean).join(' '));
        },
        finish(text) {
            clearTentative();
            if (!text && !frozen)
                restoreSelection();
            else
                render(text);
            active = false;
        },
        cancel() {
            clearTentative();
            if (!committed && !frozen)
                restoreSelection();
            else
                render(committed);
            active = false;
        },
        canSubmit: () => port.canSubmit(),
        async submit() {
            const pending = binding;
            const target = port.readDraft()?.ownerKey;
            if (pending) {
                await pending.finish();
                await port.settled();
            }
            if (disposed || port.readDraft()?.ownerKey !== target || (pending && binding !== pending))
                return;
            if (!port.readDraft()?.text.trim() || !port.canSubmit()) {
                pending?.invalidate();
                return;
            }
            try {
                sending = true;
                await submitWithBinding(() => port.submit(), pending);
            }
            finally {
                sending = false;
            }
        },
        bindSubmission(value) {
            binding = value;
            return () => {
                if (binding === value)
                    binding = undefined;
            };
        },
        subscribeUserActivity: (listener) => port.subscribeDraftChanges(listener),
        finishSubmission() {
            const pending = binding;
            if (!pending)
                return null;
            const target = owner;
            return pending
                .finish()
                .then(() => port.settled())
                .then(() => binding === pending && port.readDraft()?.ownerKey === target, () => false);
        },
        releaseSubmission() {
            binding?.release();
        },
        invalidate,
        dispose() {
            disposed = true;
            invalidate();
            unsubscribe();
        },
    };
}
//# sourceMappingURL=editor.js.map