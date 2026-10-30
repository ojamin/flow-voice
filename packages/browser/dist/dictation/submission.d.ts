import type { SubmissionBinding } from '../index.js';
/** Release ownership only after normal send succeeds; retain it on a failed send. */
export declare function submitWithBinding(submit: () => void | Promise<void>, pending?: SubmissionBinding): Promise<void>;
