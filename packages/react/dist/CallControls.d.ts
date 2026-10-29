import type { CallSession } from '@flow-voice/browser';
import type { SpeechControlAppearance } from './controls.js';
export interface CallControlsProps extends SpeechControlAppearance {
    call: CallSession;
    disabled?: boolean;
    labels?: {
        call?: string;
        mute?: string;
        unmute?: string;
        end?: string;
    };
}
export declare function CallControls({ call, disabled, labels, slots, className }: CallControlsProps): import("react").JSX.Element;
