import { expect, it, vi } from 'vitest';
import { createEditorComposerAdapter } from '../index.js';
import type { EditorDraft, EditorPort, SubmissionBinding } from '../index.js';

/** An in-memory revisioned editor. */
function editor(text: string, caret = text.length) {
  let draft: EditorDraft = { ownerKey: 'chat-a', text, selection: { start: caret, end: caret }, revision: 0 };
  const listeners = new Set<() => void>();
  const port: EditorPort = {
    readDraft: () => draft,
    replace(at, start, end, replacement, cursor) {
      if (at.revision !== draft.revision || at.ownerKey !== draft.ownerKey) return false;
      const next = draft.text.slice(0, start) + replacement + draft.text.slice(end);
      draft = { ...draft, text: next, selection: { start: cursor, end: cursor }, revision: draft.revision + 1 };
      return true;
    },
    subscribeDraftChanges(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    settled: async () => {},
    canSubmit: () => draft.text.trim() !== '',
    submit: vi.fn(),
  };
  /** A user edit: replace `[start, end)` and report it. */
  const type = (start: number, end: number, value: string) => {
    draft = { ...draft, text: draft.text.slice(0, start) + value + draft.text.slice(end), revision: draft.revision + 1 };
    listeners.forEach((listener) => listener());
  };
  const replaceDraft = (ownerKey: string) => { draft = { ...draft, ownerKey, text: '', revision: draft.revision + 1 }; };
  return { port, type, replaceDraft, text: () => draft.text, caret: () => draft.selection.end };
}

it('writes the whole hypothesis at the caret from begin, spaced from the words around it', () => {
  const e = editor('Hello world', 5);
  const adapter = createEditorComposerAdapter(e.port);
  adapter.begin();
  adapter.update({ committed: 'there', tentative: 'my' });
  expect(e.text()).toBe('Hello there my world');
  adapter.update({ committed: 'there friend', tentative: '' });
  expect(e.text()).toBe('Hello there friend world');
  expect(e.caret()).toBe('Hello there friend'.length);
});

it('moves with edits before the insertion and hands edited dictation to the user', () => {
  const e = editor('Note:');
  const adapter = createEditorComposerAdapter(e.port);
  adapter.begin();
  adapter.update({ committed: 'buy milk', tentative: '' });
  expect(e.text()).toBe('Note: buy milk');
  e.type(0, 0, '>> ');
  adapter.update({ committed: 'buy milk', tentative: 'and' });
  expect(e.text()).toBe('>> Note: buy milk and');
  e.type(13, 17, 'oat');
  adapter.update({ committed: 'buy milk and eggs', tentative: '' });
  expect(e.text()).toBe('>> Note: buy oat and eggs');
});

it('cancel keeps committed words and restores the selection when nothing was said', () => {
  const said = editor('');
  const adapter = createEditorComposerAdapter(said.port);
  adapter.begin();
  adapter.update({ committed: 'keep', tentative: 'maybe' });
  adapter.cancel();
  expect(said.text()).toBe('keep');

  const silent = editor('abc', 1);
  const quiet = createEditorComposerAdapter(silent.port);
  quiet.begin();
  quiet.update({ committed: '', tentative: 'x' });
  quiet.cancel();
  expect(silent.text()).toBe('abc');
});

it('stops without writing once the draft is replaced, and reports the send target', async () => {
  const e = editor('');
  const adapter = createEditorComposerAdapter(e.port);
  const binding: SubmissionBinding = { finish: vi.fn(async () => {}), release: vi.fn(), invalidate: vi.fn() };
  adapter.bindSubmission(binding);
  adapter.begin();
  adapter.update({ committed: 'first', tentative: '' });
  await expect(adapter.finishSubmission()).resolves.toBe(true);
  e.replaceDraft('chat-b');
  adapter.update({ committed: 'first second', tentative: '' });
  expect(e.text()).toBe('');
  expect(binding.invalidate).toHaveBeenCalledTimes(1);
  expect(adapter.finishSubmission()).toBeNull();
});
