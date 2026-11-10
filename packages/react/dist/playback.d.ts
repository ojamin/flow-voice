import type { AutoReader, AutoReaderOptions, SpeechPlayer, SpeechPlayerSnapshot } from '@flow-voice/browser';
import type { PlayerControlsProps, ReadAloudButtonProps } from './index.js';
export declare function useSpeechPlayer(player: SpeechPlayer): SpeechPlayerSnapshot;
/** Reader setup is effect-owned (including StrictMode cleanup); callbacks stay current. */
export declare function useAutoRead(options: AutoReaderOptions): AutoReader;
export declare function PlayerControls({ player, className, children, slots, hideWhenIdle, disabled: allDisabled, labels, }: PlayerControlsProps): import("react").DetailedReactHTMLElement<{
    className: string | undefined;
}, HTMLElement> | null;
export declare function ReadAloudButton({ onRead, player, messageId, disabled, className, children, render, }: ReadAloudButtonProps): import("react").DetailedReactHTMLElement<{
    type: string;
    disabled: boolean | undefined;
    className: string | undefined;
    onClick: () => void;
    'aria-label': string;
}, HTMLElement> | import("react").FunctionComponentElement<ReadAloudButtonProps & {
    player: SpeechPlayer;
}>;
