/** Reference transaction for a native textarea. Rich editors should implement the same contract
 * using their own mapped positions. Call invalidate() before replacing a draft or navigating. */
export function createTextareaComposerAdapter(options) {
    const element = options.element;
    let binding;
    let active = false;
    let start = 0;
    let end = 0;
    let previous = element.value;
    let transcript = '';
    let frozen = 0;
    let committed = '';
    let selected = '';
    let writing = false;
    const listeners = new Set();
    const activity = () => {
        if (!writing)
            listeners.forEach((listener) => listener());
    };
    const input = () => {
        if (writing)
            return;
        activity();
        const next = element.value;
        if (active) {
            let left = 0;
            while (left < previous.length && left < next.length && previous[left] === next[left])
                left++;
            let oldRight = previous.length;
            let newRight = next.length;
            while (oldRight > left && newRight > left && previous[oldRight - 1] === next[newRight - 1]) {
                oldRight--;
                newRight--;
            }
            const delta = newRight - oldRight;
            if (oldRight <= start && left < start) {
                start += delta;
                end += delta;
            }
            else if (left < end || left === start) {
                // An edit inside speech-owned text transfers that text to the user. Freeze the
                // rendered prefix, and own only future words; never replace the user's correction.
                frozen = transcript.length;
                start = end = Math.max(newRight, end + delta);
            }
        }
        previous = next;
    };
    element.addEventListener('input', input);
    element.addEventListener('keydown', activity);
    const replace = (text) => {
        if (!active)
            return;
        const replacement = text.slice(Math.min(frozen, text.length));
        const selectionStart = element.selectionStart;
        const selectionEnd = element.selectionEnd;
        const oldEnd = end;
        element.setRangeText(replacement, start, end, 'preserve');
        end = start + replacement.length;
        // Preserve the user's current caret, including when dictation inserts before it.
        const map = (position) => position >= oldEnd ? position + end - oldEnd : Math.min(position, end);
        element.setSelectionRange(map(selectionStart), map(selectionEnd), element.selectionDirection);
        previous = element.value;
        transcript = text;
        writing = true;
        try {
            options.onValueChange?.(element.value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }
        finally {
            writing = false;
        }
    };
    const invalidate = () => {
        active = false;
        binding?.invalidate();
        binding = undefined;
    };
    return {
        begin() {
            start = element.selectionStart;
            end = element.selectionEnd;
            previous = element.value;
            selected = previous.slice(start, end);
            transcript = committed = '';
            frozen = 0;
            active = true;
        },
        update(value) {
            committed = value.committed;
            replace([value.committed, value.tentative].filter(Boolean).join(' '));
        },
        finish(text) {
            replace(!text && !frozen ? selected : text);
            active = false;
        },
        cancel() {
            replace(!committed && !frozen ? selected : committed);
            active = false;
        },
        canSubmit: options.canSubmit,
        async submit() {
            const pending = binding;
            await pending?.finish();
            if (!element.value.trim() || !options.canSubmit()) {
                pending?.invalidate();
                return;
            }
            try {
                await options.submit();
                pending?.release();
            }
            catch (error) {
                pending?.failed?.();
                throw error;
            }
        },
        bindSubmission(value) {
            binding = value;
            return () => {
                if (binding === value)
                    binding = undefined;
            };
        },
        subscribeUserActivity(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        invalidate,
        dispose() {
            invalidate();
            listeners.clear();
            element.removeEventListener('input', input);
            element.removeEventListener('keydown', activity);
        },
    };
}
//# sourceMappingURL=textarea.js.map