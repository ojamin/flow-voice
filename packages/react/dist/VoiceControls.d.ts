import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { SpeechPlayer, VoiceMode } from '@flow-voice/browser';
import type { SpeechControlAppearance } from './controls.js';
import type { VoiceSelectProps } from './VoiceSelect.js';
export interface VoiceControlsProps extends SpeechControlAppearance {
    mode: VoiceMode;
    player: SpeechPlayer;
    conversation: string | null;
    voice: VoiceSelectProps;
    disabled?: boolean;
    labels?: {
        voice?: string;
        options?: string;
        oneChat?: string;
        onScreen?: string;
    };
    renderOptions?(props: {
        triggerProps: ButtonHTMLAttributes<HTMLButtonElement>;
        content: ReactNode;
        open: boolean;
        onOpenChange(open: boolean): void;
    }): ReactNode;
}
export declare function VoiceControls({ mode, player, conversation, voice, disabled, labels, slots, className, renderOptions, }: VoiceControlsProps): import("react").JSX.Element;
