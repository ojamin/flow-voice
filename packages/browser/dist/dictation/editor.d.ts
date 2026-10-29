import type { ComposerAdapter } from '../index.js';
/** A rich editor's draft as dictation sees it. `ownerKey` changes when the draft is replaced
 * (another chat, a sent message); `revision` lets the editor refuse stale writes. */
export interface EditorDraft {
    readonly ownerKey: string;
    readonly text: string;
    readonly selection: {
        readonly start: number;
        readonly end: number;
    };
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
/** The textarea adapter's contract over a revisioned rich editor: one insertion transaction
 * per dictation, captured at `begin`, never the latest caret. User edits inside dictated text
 * make that text theirs; only later words are written. */
export declare function createEditorComposerAdapter(port: EditorPort): EditorComposerAdapter;
