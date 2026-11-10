import type { ComposerAdapter } from '../index.js';
/** Reference transaction for a native textarea. Rich editors should implement the same contract
 * using their own mapped positions. Call invalidate() before replacing a draft or navigating. */
export declare function createTextareaComposerAdapter(options: {
    element: HTMLTextAreaElement;
    canSubmit(): boolean;
    submit(): Promise<void>;
    onValueChange?(value: string): void;
}): ComposerAdapter & {
    submit(): Promise<void>;
    invalidate(): void;
    dispose(): void;
};
