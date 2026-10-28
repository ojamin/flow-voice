import type { SpeechPlayer, SpeechPlayerSnapshot } from '@flow-voice/browser';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
/** Hooks subscribe to host-owned stores; controller/player lifecycle is owned by the host. */
export { useSpeechPlayer, useAutoRead, PlayerControls, ReadAloudButton } from './playback.js';
export { useDictation } from './dictation.js';
export { MicButton, type MicButtonProps } from './MicButton.js';
export interface PlayerControlsProps {
    player: SpeechPlayer;
    className?: string;
    children?(snapshot: SpeechPlayerSnapshot, player: SpeechPlayer): ReactNode;
}
export interface ReadAloudButtonProps {
    onRead(): void;
    player?: SpeechPlayer;
    messageId?: string;
    render?(state: {
        playing: boolean;
        buttonProps: ButtonHTMLAttributes<HTMLButtonElement>;
    }): ReactNode;
    disabled?: boolean;
    className?: string;
    children?: ReactNode;
}
