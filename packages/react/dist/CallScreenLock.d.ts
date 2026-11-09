import type { CallSession } from '@flow-voice/browser';
export interface CallScreenLockProps {
    call: CallSession;
    /** Applied to the entry button, not the modal viewport. */
    className?: string;
}
/** Pocket-safe screen cover, not an OS lock or a guarantee of background recording.
 * Native modal dialog supplies focus containment and makes the rest of the document inert. */
export declare function CallScreenLock({ call, className }: CallScreenLockProps): import("react").JSX.Element | null;
