import type { ComponentPropsWithRef, ReactNode } from 'react';
import type { DictationController, DictationSnapshot } from '@flow-voice/browser';
import type { SpeechControlSlots } from './controls.js';
export interface MicButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'onClick'> {
    controller: DictationController;
    children?: ReactNode | ((snapshot: DictationSnapshot) => ReactNode);
    renderStatus?(snapshot: DictationSnapshot): ReactNode;
    showLevel?: boolean;
    statusClassName?: string;
    slots?: SpeechControlSlots;
    labels?: {
        idle?: string;
        listening?: string;
        connecting?: string;
        finalizing?: string;
    };
}
/** Unstyled native controls: hosts supply their button/focus/disabled visual language. */
export declare function MicButton({ controller, children, renderStatus, showLevel, statusClassName, disabled, slots, labels, ...props }: MicButtonProps): ReactNode;
