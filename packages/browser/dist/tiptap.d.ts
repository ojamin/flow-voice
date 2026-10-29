import type { Editor } from '@tiptap/core';
import { type EditorComposerAdapter } from './dictation/editor.js';
export interface TiptapComposerOptions {
    editor: Editor;
    ownerKey(): string;
    canSubmit(): boolean;
    submit(): Promise<void>;
    tentativeClassName?: string;
}
/** Optional TipTap binding. Interim hypotheses are widgets, never document/history edits. */
export declare function createTiptapComposerAdapter(options: TiptapComposerOptions): EditorComposerAdapter & {
    dispose(): void;
};
