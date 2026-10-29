import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  createEditorComposerAdapter,
  type DraftChange,
  type EditorComposerAdapter,
  type EditorEdit,
  type EditorPort,
  type TentativeText,
} from './dictation/editor.js';

export interface TiptapComposerOptions {
  editor: Editor;
  ownerKey(): string;
  canSubmit(): boolean;
  submit(): Promise<void>;
  tentativeClassName?: string;
}

/** Flatten textblocks with the same paragraph separator as TipTap's getText(). Marks
 * have no width; inline atoms occupy one character. Keep the inverse position map so
 * document structural tokens are never mistaken for text offsets. */
function project(doc: ProseMirrorNode) {
  let text = '';
  const positions: number[] = [];
  doc.descendants((block, at) => {
    if (!block.isTextblock) return;
    if (positions.length) {
      text += '\n\n';
      positions.push(at + 1, at + 1);
    }
    positions[text.length] = at + 1;
    block.descendants((node, relative) => {
      if (!node.isText && !node.isLeaf) return;
      const value = node.text ?? (node.type.name === 'hardBreak' ? '\n' : '\ufffc');
      for (let i = 0; i < value.length; i++) {
        positions[text.length + i] = at + 1 + relative + i;
      }
      text += value;
      positions[text.length] = at + 1 + relative + node.nodeSize;
    });
    return false;
  });
  if (!positions.length) positions.push(0);
  return {
    text,
    position(offset: number) { return positions[Math.max(0, Math.min(offset, text.length))]!; },
    offset(position: number) {
      let i = 0;
      while (i < positions.length - 1 && positions[i + 1]! <= position) i++;
      return i;
    },
  };
}

/** Optional TipTap binding. Interim hypotheses are widgets, never document/history edits. */
export function createTiptapComposerAdapter(options: TiptapComposerOptions): EditorComposerAdapter & { dispose(): void } {
  const { editor } = options;
  const key = new PluginKey('flow-voice-tentative');
  let revision = 0;
  let tentative: TentativeText | null = null;
  const listeners = new Set<(change?: DraftChange) => void>();
  editor.registerPlugin(new Plugin({
    key,
    props: {
      decorations(state) {
        if (!tentative || tentative.draft.ownerKey !== options.ownerKey()) return DecorationSet.empty;
        return DecorationSet.create(state.doc, [Decoration.widget(
          project(state.doc).position(tentative.at),
          () => {
            const span = document.createElement('span');
            if (options.tentativeClassName) span.className = options.tentativeClassName;
            span.setAttribute('data-flow-voice-tentative', '');
            span.setAttribute('aria-label', 'Tentative transcription');
            span.contentEditable = 'false';
            span.textContent = tentative!.text;
            return span;
          },
          { side: 1, key: tentative.text },
        )]);
      },
    },
  }));
  // TipTap publishes after the complete transaction has been applied, so subscribers
  // can safely reread the new revision and refresh decorations without nested applies.
  const transaction = ({ transaction: root, appendedTransactions }: {
    transaction: Transaction;
    appendedTransactions: Transaction[];
  }) => {
    revision++;
    if (root.getMeta(key)) return;
    const edits: EditorEdit[] = [];
    let replaced = false;
    for (const tr of [root, ...appendedTransactions]) {
      tr.mapping.maps.forEach((map, index) => {
        const before = tr.docs[index]!;
        const oldText = project(before);
        const newText = project(tr.docs[index + 1] ?? tr.doc);
        let delta = 0;
        map.forEach((from, to, newFrom, newTo) => {
          if (from <= 1 && to >= before.content.size - 1 && to > from) replaced = true;
          const start = oldText.offset(from);
          const end = oldText.offset(to);
          const insertedLength = newText.offset(newTo) - newText.offset(newFrom);
          edits.push({ start: start + delta, end: end + delta, insertedLength });
          delta += insertedLength - (end - start);
        });
      });
    }
    listeners.forEach((listener) => listener({ edits, replaced }));
  };
  editor.on('transaction', transaction);
  const port: EditorPort = {
    readDraft() {
      if (editor.isDestroyed) return null;
      const flat = project(editor.state.doc);
      return {
        ownerKey: options.ownerKey(), revision, text: flat.text,
        selection: { start: flat.offset(editor.state.selection.from), end: flat.offset(editor.state.selection.to) },
      };
    },
    replace(draft, start, end, replacement, cursor) {
      if (editor.isDestroyed || draft.revision !== revision || draft.ownerKey !== options.ownerKey()) return false;
      const flat = project(editor.state.doc);
      const tr = editor.state.tr.insertText(replacement, flat.position(start), flat.position(end)).setMeta(key, true);
      tr.setSelection(TextSelection.near(tr.doc.resolve(project(tr.doc).position(cursor))));
      editor.view.dispatch(tr);
      return true;
    },
    subscribeDraftChanges(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setTentative(value) {
      tentative = value;
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(key, true).setMeta('addToHistory', false));
    },
    settled: async () => {},
    canSubmit: options.canSubmit,
    submit: options.submit,
  };
  const adapter = createEditorComposerAdapter(port);
  const activity = () => listeners.forEach((listener) => listener());
  const dom = editor.view.dom;
  dom.addEventListener('keydown', activity);
  dom.addEventListener('input', activity);
  const dispose = () => {
    adapter.dispose();
    editor.off('transaction', transaction);
    editor.off('destroy', dispose);
    dom.removeEventListener('keydown', activity);
    dom.removeEventListener('input', activity);
    listeners.clear();
    if (!editor.isDestroyed) editor.unregisterPlugin(key);
  };
  editor.on('destroy', dispose);
  return { ...adapter, dispose };
}
