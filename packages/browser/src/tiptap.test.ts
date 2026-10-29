// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Editor, Extension, Mark, Node } from '@tiptap/core';
import { history, undo, redo } from '@tiptap/pm/history';
import { Plugin } from '@tiptap/pm/state';
import { createDictationController, type DictationController, type DictationTransport } from './index.js';
import type { SttServerMessage } from '@flow-voice/core';
import { createTiptapComposerAdapter } from './tiptap.js';

// Real TipTap/PM schema and history, without bringing an optional UI kit into dependencies.
const extensions = [
  Node.create({ name: 'doc', topNode: true, content: 'block+' }),
  Node.create({ name: 'paragraph', group: 'block', content: 'inline*', parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0] }),
  Node.create({ name: 'text', group: 'inline' }),
  Mark.create({ name: 'bold', parseHTML: () => [{ tag: 'strong' }], renderHTML: () => ['strong', 0] }),
  Extension.create({ name: 'history', addProseMirrorPlugins: () => [history()] }),
];
const editors: Editor[] = [];
const adapters: ReturnType<typeof createTiptapComposerAdapter>[] = [];
const controllers: DictationController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  adapters.splice(0).forEach((adapter) => adapter.dispose());
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.useRealTimers();
});
function setup(content = '<p>before after</p>', clearAfterSend = false) {
  const editor = new Editor({ extensions, content });
  editors.push(editor);
  editor.commands.setTextSelection(Math.min(8, editor.state.doc.content.size - 1));
  const sent: string[] = [];
  let allowed = true;
  let owner = 'chat-a';
  const adapter = createTiptapComposerAdapter({
    editor, ownerKey: () => owner, canSubmit: () => allowed,
    submit: async () => {
      sent.push(editor.getText());
      if (clearAfterSend) editor.commands.clearContent();
    },
  });
  adapters.push(adapter);
  return { editor, adapter, sent, hold: () => { allowed = false; }, switchOwner: () => { owner = 'chat-b'; } };
}
const widget = (editor: Editor) => editor.view.dom.querySelector('[data-flow-voice-tentative]');
const binding = () => ({ finish: vi.fn(async () => {}), invalidate: vi.fn(), release: vi.fn(), failed: vi.fn() });

it('never sends an empty draft and reports failed submission without losing the draft', async () => {
  const { editor, adapter, sent } = setup('<p></p>');
  const pending = binding();
  adapter.bindSubmission(pending);
  await adapter.submit();
  expect(sent).toEqual([]);
  expect(pending.invalidate).toHaveBeenCalledOnce();
  adapter.dispose();
  editor.commands.setContent('<p>Retain me</p>');
  const throwing = createTiptapComposerAdapter({
    editor, ownerKey: () => 'a', canSubmit: () => true,
    submit: async () => { throw new Error('Send failed'); },
  });
  adapters.push(throwing);
  const failed = binding();
  throwing.bindSubmission(failed);
  await expect(throwing.submit()).rejects.toThrow('Send failed');
  expect(failed.failed).toHaveBeenCalledOnce();
  expect(failed.release).not.toHaveBeenCalled();
  expect(editor.getText()).toBe('Retain me');
});

it.each(['clear', 'replace', 'identical'])('invalidates a whole draft reset (%s)', (action) => {
  const { editor, adapter } = setup('<p>words</p>');
  const pending = binding();
  adapter.bindSubmission(pending);
  adapter.begin();
  adapter.update({ committed: '', tentative: 'perhaps' });
  if (action === 'clear') editor.commands.clearContent();
  else editor.commands.setContent(action === 'identical' ? '<p>words</p>' : '<p>Replacement draft</p>');
  expect(pending.invalidate).toHaveBeenCalledOnce();
  adapter.update({ committed: 'stale words', tentative: 'stale' });
  expect(editor.getText()).toBe(action === 'clear' ? '' : action === 'identical' ? 'words' : 'Replacement draft');
  expect(widget(editor)).toBeNull();
});

it('keeps normal Send synchronous when no final is pending', async () => {
  const { adapter, sent } = setup();
  const sending = adapter.submit();
  expect(sent).toEqual(['before after']);
  await sending;
});

it('renders interim words outside JSON/text/selection/history and clears on cancel or empty final', () => {
  const { editor, adapter } = setup();
  editor.commands.setTextSelection({ from: 1, to: 7 });
  const before = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  for (const finish of [() => adapter.cancel(), () => adapter.finish('')]) {
    adapter.begin();
    adapter.update({ committed: '', tentative: 'perhaps' });
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getText()).toBe('before after');
    expect(editor.state.selection.toJSON()).toEqual(selection);
    expect(widget(editor)?.textContent?.trim()).toBe('perhaps');
    finish();
    expect(editor.getJSON()).toEqual(before);
    expect(widget(editor)).toBeNull();
    expect(undo(editor.state, editor.view.dispatch)).toBe(false);
  }
});

it('maps edits before speech and freezes only committed words after a correction', () => {
  const { editor, adapter } = setup();
  adapter.begin();
  adapter.update({ committed: 'hello', tentative: 'world' });
  expect(editor.getText()).toBe('before hello after');
  editor.commands.insertContentAt(1, 'A ');
  adapter.update({ committed: 'hello world', tentative: 'maybe' });
  expect(editor.getText()).toBe('A before hello world after');
  editor.commands.insertContentAt({ from: 10, to: 15 }, 'hi');
  adapter.finish('hello world again');
  expect(editor.getText()).toBe('A before hi world again after');
  expect(widget(editor)).toBeNull();
});

it('does not restore a selected phrase that the author edited during an interim-only hypothesis', () => {
  const { editor, adapter } = setup();
  editor.commands.setTextSelection({ from: 1, to: 7 });
  adapter.begin();
  adapter.update({ committed: '', tentative: 'perhaps' });
  editor.commands.insertContentAt({ from: 1, to: 7 }, 'corrected');
  adapter.cancel();
  expect(editor.getText()).toBe('corrected after');
  expect(widget(editor)).toBeNull();
});

it('clears interim presentation on invalidation and owner changes without touching the new draft', () => {
  const { editor, adapter, switchOwner } = setup();
  const pending = binding();
  adapter.bindSubmission(pending);
  adapter.begin();
  adapter.update({ committed: '', tentative: 'perhaps' });
  switchOwner();
  adapter.update({ committed: '', tentative: 'stale' });
  expect(widget(editor)).toBeNull();
  expect(pending.invalidate).toHaveBeenCalledOnce();
  expect(editor.getText()).toBe('before after');
  adapter.begin();
  adapter.update({ committed: '', tentative: 'new' });
  adapter.invalidate();
  expect(widget(editor)).toBeNull();
});

it('waits for host send success before releasing ownership', async () => {
  const { editor, adapter } = setup();
  adapter.dispose();
  let complete!: () => void;
  const sent = new Promise<void>((resolve) => { complete = resolve; });
  const waiting = createTiptapComposerAdapter({
    editor, ownerKey: () => 'a', canSubmit: () => true, submit: () => sent,
  });
  adapters.push(waiting);
  waiting.begin();
  const pending = binding();
  waiting.bindSubmission(pending);
  const sending = waiting.submit();
  await vi.waitFor(() => expect(pending.finish).toHaveBeenCalledOnce());
  expect(pending.release).not.toHaveBeenCalled();
  complete();
  await sending;
  expect(pending.release).toHaveBeenCalledOnce();
});

it('maps multiple steps exactly even when the combined text diff spans the speech range', () => {
  const { editor, adapter } = setup();
  adapter.begin();
  adapter.update({ committed: 'hello', tentative: '' });
  editor.view.dispatch(editor.state.tr.insertText('A ', 1).insertText('!', 21));
  adapter.finish('hello world');
  expect(editor.getText()).toBe('A before hello world after!');
});

it('includes native appended transactions in the sequential edit mapping', () => {
  const { editor, adapter } = setup();
  editor.registerPlugin(new Plugin({
    appendTransaction(transactions, _old, state) {
      if (transactions.some((tr) => tr.getMeta('test-native-edit'))) return state.tr.insertText('A ', 1);
      return null;
    },
  }));
  adapter.begin();
  adapter.update({ committed: 'hello', tentative: '' });
  editor.view.dispatch(editor.state.tr.insertText('!', 19).setMeta('test-native-edit', true));
  adapter.finish('hello world');
  expect(editor.getText()).toBe('A before hello world after!');
});

it('maps flattened offsets across paragraphs and marks and preserves untouched formatting', () => {
  const { editor, adapter } = setup('<p><strong>first</strong> line</p><p>second <strong>last</strong></p>');
  editor.commands.setTextSelection(20); // after "second " in paragraph two
  adapter.begin();
  adapter.update({ committed: 'new', tentative: 'words' });
  expect(editor.getText()).toBe('first line\n\nsecond new last');
  editor.commands.insertContentAt(1, 'A ');
  adapter.finish('new words');
  expect(editor.getText()).toBe('A first line\n\nsecond new words last');
  expect(editor.getHTML()).toContain('<strong>last</strong>');
});

it('supports undo/redo of committed text without resurrecting tentative words', () => {
  const { editor, adapter } = setup();
  adapter.begin();
  adapter.update({ committed: 'hello', tentative: 'phantom' });
  adapter.finish('hello');
  expect(undo(editor.state, editor.view.dispatch)).toBe(true);
  expect(editor.getText()).toBe('before after');
  expect(widget(editor)).toBeNull();
  expect(redo(editor.state, editor.view.dispatch)).toBe(true);
  expect(editor.getText()).toBe('before hello after');
});

it('maps a paragraph split before the insertion and preserves a correction after active undo', () => {
  const { editor, adapter } = setup('<p>first line</p><p>second last</p>');
  editor.commands.setTextSelection(20);
  adapter.begin();
  adapter.update({ committed: 'new', tentative: 'phantom' });
  editor.view.dispatch(editor.state.tr.split(6));
  adapter.finish('new words');
  expect(editor.getText()).toBe('first\n\n line\n\nsecond new words last');

  adapter.begin();
  adapter.update({ committed: 'more', tentative: 'never' });
  undo(editor.state, editor.view.dispatch);
  adapter.finish('more final');
  expect(editor.getText()).not.toContain('more');
  expect(editor.getText()).toContain('final');
  expect(widget(editor)).toBeNull();
});

it('awaits a delayed final and does not send after disposal or owner change', async () => {
  const { editor, adapter, sent, switchOwner } = setup();
  adapter.begin();
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const pending = { ...binding(), finish: () => done };
  adapter.bindSubmission(pending);
  const sending = adapter.submit();
  expect(sent).toEqual([]);
  adapter.finish('final words');
  finish();
  await sending;
  expect(sent).toEqual(['before final words after']);
  const held = adapter.submit();
  switchOwner();
  await held;
  expect(sent).toHaveLength(1);
  const disposed = adapter.submit();
  adapter.dispose();
  editor.commands.setContent('<p>another conversation</p>');
  await disposed;
  expect(sent).toHaveLength(1);
  expect(pending.invalidate).toHaveBeenCalledOnce();
});

it('clears presentation and detaches on dispose, including editor destruction', () => {
  const { editor, adapter } = setup();
  adapter.begin();
  adapter.update({ committed: '', tentative: 'perhaps' });
  adapter.dispose();
  expect(widget(editor)).toBeNull();
  adapter.update({ committed: 'stale', tentative: 'stale' });
  expect(editor.getText()).toBe('before after');
  editor.destroy();
});

it.each(['silence', 'keyword'])('auto-sends exactly once through normal submit (%s)', async (mode) => {
  vi.useFakeTimers();
  const { adapter, editor, sent } = setup('<p></p>', true);
  let receive!: (message: SttServerMessage) => void;
  const transport: DictationTransport = {
    connect: async (options) => { receive = options.onMessage; },
    send: async (message) => {
      if (message.type === 'start') receive({ type: 'ready', audio: message.audio, interim: true });
      if (message.type === 'stop') {
        receive({ type: 'final', revision: 3, text: mode === 'keyword' ? 'hello send now' : 'hello' });
        receive({ type: 'ended', reason: 'stopped' });
      }
    },
    close: vi.fn(),
  };
  const controller = createDictationController({
    composer: adapter, transport,
    capture: () => ({ start: async () => {}, stop: async () => {} }),
    audio: { encoding: 'pcm_s16le', channels: 1, sampleRate: 16000 },
    stopAfterSend: false,
    autoSend: { enabled: true, silenceMs: 500, keyword: 'send now', afterPause: mode !== 'keyword' },
  });
  controllers.push(controller);
  await controller.start();
  receive({ type: 'partial', revision: 1, committed: mode === 'keyword' ? 'hello send now' : 'hello', tentative: '' });
  await vi.advanceTimersByTimeAsync(1500);
  expect(sent).toEqual(['hello']);
  await vi.advanceTimersByTimeAsync(5000);
  expect(sent).toHaveLength(1);
  expect(controller.getSnapshot().status).toBe('listening');
  expect(editor.getText()).toBe('');
  receive({ type: 'partial', revision: 1, committed: 'next draft', tentative: '' });
  expect(editor.getText()).toBe('next draft');
  controller.notifyUserActivity();
  await vi.advanceTimersByTimeAsync(2000);
  expect(sent).toHaveLength(1);
});

it('keeps committed words when host admission prevents send', async () => {
  const { adapter, editor, sent, hold } = setup();
  adapter.begin();
  adapter.update({ committed: 'hello', tentative: 'not final' });
  hold();
  adapter.cancel();
  await adapter.submit();
  expect(sent).toEqual([]);
  expect(editor.getText()).toBe('before hello after');
});
