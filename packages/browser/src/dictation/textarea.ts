import type { ComposerAdapter, SubmissionBinding } from '../index.js';
import { mapOwnedRange, textEdit } from './range.js';
import { submitWithBinding } from './submission.js';

/** Reference transaction for a native textarea. Rich editors should implement the same contract
 * using their own mapped positions. Call invalidate() before replacing a draft or navigating. */
export function createTextareaComposerAdapter(options: {
  element: HTMLTextAreaElement;
  canSubmit(): boolean;
  submit(): Promise<void>;
  onValueChange?(value: string): void;
}): ComposerAdapter & { submit(): Promise<void>; invalidate(): void; dispose(): void } {
  const element = options.element;
  let binding: SubmissionBinding | undefined;
  let active = false;
  let start = 0;
  let end = 0;
  let previous = element.value;
  let transcript = '';
  let frozen = 0;
  let committed = '';
  let selected = '';
  let writing = false;
  const listeners = new Set<() => void>();
  const activity = () => {
    if (!writing) listeners.forEach((listener) => listener());
  };
  const input = () => {
    if (writing) return;
    activity();
    const next = element.value;
    if (active) {
      const mapped = mapOwnedRange(start, end, textEdit(previous, next));
      if (mapped.touched) {
        // An edit inside speech-owned text transfers that text to the user. Freeze the
        // rendered prefix, and own only future words; never replace the user's correction.
        frozen = transcript.length;
      }
      start = mapped.start;
      end = mapped.end;
    }
    previous = next;
  };
  element.addEventListener('input', input);
  element.addEventListener('keydown', activity);
  const replace = (text: string) => {
    if (!active) return;
    const replacement = text.slice(Math.min(frozen, text.length));
    const selectionStart = element.selectionStart;
    const selectionEnd = element.selectionEnd;
    const oldEnd = end;
    element.setRangeText(replacement, start, end, 'preserve');
    end = start + replacement.length;
    // Preserve the user's current caret, including when dictation inserts before it.
    const map = (position: number) =>
      position >= oldEnd ? position + end - oldEnd : Math.min(position, end);
    element.setSelectionRange(map(selectionStart), map(selectionEnd), element.selectionDirection);
    previous = element.value;
    transcript = text;
    writing = true;
    try {
      options.onValueChange?.(element.value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } finally {
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
      await submitWithBinding(() => options.submit(), pending);
    },
    bindSubmission(value) {
      binding = value;
      return () => {
        if (binding === value) binding = undefined;
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
