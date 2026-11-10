import type { SpeechControlAppearance } from './controls.js';
import type { VoiceChoiceState } from './voice-options.js';
export type { VoiceChoiceState } from './voice-options.js';
export interface VoiceSelectProps extends SpeechControlAppearance {
    value?: string;
    onChange(voice: string | undefined): void;
    choices: VoiceChoiceState;
    disabled?: boolean;
    defaultLabel?: string;
    label?: string;
}
export declare function VoiceSelect({ value, onChange, choices, disabled, defaultLabel, label, slots, className, }: VoiceSelectProps): import("react").JSX.Element;
