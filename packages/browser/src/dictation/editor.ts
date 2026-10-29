import type { ComposerAdapter, SubmissionBinding } from '../index.js';

/** A rich editor's draft as dictation sees it. `ownerKey` changes when the draft is replaced
 * (another chat, a sent message); `revision` lets the editor refuse stale writes. */
export interface EditorDraft {
  readonly ownerKey: string;
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
  readonly revision: number;
}

/** What a revisioned rich editor offers dictation. */
export interface EditorPort {
  readDraft(): EditorDraft | null;
  /** Replace `[start, end)` of `draft` at its revision and leave the caret at `cursor`.
   * False when the editor refuses (the draft moved on, or this composer takes no text). */
  replace(draft: EditorDraft, start: number, end: number, replacement: string, cursor: number): boolean;
  /** Native edits and selection changes only, never dictation's own writes. */
  subscribeDraftChanges(listener: () => void): () => void;
  /** Resolves once the editor has rendered dictation's last write, so a send that reads the
   * draft sees the final transcript. */
  settled(): Promise<void>;
  canSubmit(): boolean;
  /** The host's normal send path. */
  submit(): void;
}

export interface EditorComposerAdapter extends ComposerAdapter {
  /** For a host Send button outside the adapter: null while no dictation owns the draft, else
   * whether the draft the transcript finished into is still the one being sent. */
  finishSubmission(): Promise<boolean> | null;
  releaseSubmission(): void;
  /** The draft was replaced or the route changed: stop without touching the new draft. */
  invalidate(): void;
}

/** A character that starts a word, so dictated words right before it need a separating space. */
const STARTS_WORD = /[^\s.,!?;:)\]}]/;

/** Separate dictated words from the draft text around the owned range. */
function spaced(words: string, before: string | undefined, after: string | undefined) {
  let text = before === undefined || /\s/.test(before) ? words.trimStart() : words;
  if (!text) return '';
  if (before !== undefined && !/\s/.test(before) && !/^\s/.test(text)) text = ` ${text}`;
  if (after !== undefined && STARTS_WORD.test(after) && !/\s$/.test(text)) text = `${text} `;
  return text;
}

/** The textarea adapter's contract over a revisioned rich editor: one insertion transaction
 * per dictation, captured at `begin`, never the latest caret. User edits inside dictated text
 * make that text theirs; only later words are written. */
export function createEditorComposerAdapter(port: EditorPort): EditorComposerAdapter {
  let binding: SubmissionBinding | undefined;
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

  const stop = () => {
    active = false;
  };
  const invalidate = () => {
    stop();
    const current = binding;
    binding = undefined;
    current?.invalidate();
  };
  /** The current draft, with the owned range moved past any edits made since the last write. */
  const sync = () => {
    const draft = port.readDraft();
    if (!draft || draft.ownerKey !== owner) {
      invalidate();
      return null;
    }
    const next = draft.text;
    if (next !== expected) {
      let left = 0;
      while (left < expected.length && left < next.length && expected[left] === next[left]) left++;
      let oldRight = expected.length;
      let newRight = next.length;
      while (oldRight > left && newRight > left && expected[oldRight - 1] === next[newRight - 1]) {
        oldRight--;
        newRight--;
      }
      const delta = newRight - oldRight;
      if (oldRight <= start && left < start) {
        start += delta;
        end += delta;
      } else if (left < end || left === start) {
        // An edit inside dictated text hands that text to the user; keep only future words.
        frozen = transcript.length;
        start = end = Math.max(newRight, end + delta);
      }
      expected = next;
    }
    return draft;
  };
  const write = (replacementFor: (draft: EditorDraft) => string) => {
    const draft = sync();
    if (!draft) return;
    const replacement = replacementFor(draft);
    const oldEnd = end;
    if (draft.text.slice(start, oldEnd) === replacement) return;
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
  const render = (text: string) => {
    if (!active) return;
    // `frozen` is only known after `sync` has seen the user's latest edits.
    write((draft) =>
      spaced(text.slice(Math.min(frozen, text.length)), draft.text[start - 1], draft.text[end]),
    );
    transcript = text;
  };
  const restoreSelection = () => {
    if (active) write(() => selected);
  };

  return {
    begin() {
      const draft = port.readDraft();
      active = draft !== null;
      if (!draft) return;
      owner = draft.ownerKey;
      start = draft.selection.start;
      end = draft.selection.end;
      expected = draft.text;
      selected = draft.text.slice(start, end);
      transcript = committed = '';
      frozen = 0;
    },
    update(value) {
      committed = value.committed;
      render([value.committed, value.tentative].filter(Boolean).join(' '));
    },
    finish(text) {
      if (!text && !frozen) restoreSelection();
      else render(text);
      stop();
    },
    cancel() {
      if (!committed && !frozen) restoreSelection();
      else render(committed);
      stop();
    },
    canSubmit: () => port.canSubmit(),
    async submit() {
      const pending = binding;
      await pending?.finish();
      if (!port.canSubmit()) return;
      port.submit();
      pending?.release();
    },
    bindSubmission(value) {
      binding = value;
      return () => {
        if (binding === value) binding = undefined;
      };
    },
    subscribeUserActivity: (listener) => port.subscribeDraftChanges(listener),
    finishSubmission() {
      const pending = binding;
      if (!pending) return null;
      const target = owner;
      return pending
        .finish()
        .then(() => port.settled())
        .then(
          () => port.readDraft()?.ownerKey === target,
          () => false,
        );
    },
    releaseSubmission() {
      binding?.release();
    },
    invalidate,
  };
}
