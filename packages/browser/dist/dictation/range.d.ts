/** Sequential edits, each expressed in the text immediately before that edit. */
export interface EditorEdit {
    readonly start: number;
    readonly end: number;
    readonly insertedLength: number;
}
/** The single contiguous edit inferred by plain-text controls. Rich ports supply exact edits. */
export declare function textEdit(previous: string, next: string): EditorEdit;
/** Editing owned words hands them to the author; only later transcript words remain ours. */
export declare function mapOwnedRange(start: number, end: number, edit: EditorEdit): {
    start: number;
    end: number;
    touched: boolean;
};
