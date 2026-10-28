import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { DictationController, DictationSnapshot } from '@flow-voice/browser';
export interface MicButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> {
    controller: DictationController;
    children?: ReactNode | ((snapshot: DictationSnapshot) => ReactNode);
    renderStatus?(snapshot: DictationSnapshot): ReactNode;
    showLevel?: boolean;
    statusClassName?: string;
}
/** Unstyled native controls: hosts supply their button/focus/disabled visual language. */
export declare function MicButton({ controller, children, renderStatus, showLevel, statusClassName, disabled, ...props }: MicButtonProps): ReactNode;
