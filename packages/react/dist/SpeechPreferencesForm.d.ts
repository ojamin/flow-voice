import type { SpeechUserPreferences } from '@flow-voice/core';
import type { SpeechControlAppearance } from './controls.js';
import type { VoiceChoiceState } from './VoiceSelect.js';
export interface SpeechPreferencesFormProps extends SpeechControlAppearance {
    initial: SpeechUserPreferences;
    stt: boolean;
    tts: boolean;
    choices: VoiceChoiceState;
    speakerNames?: readonly string[];
    onSave(value: SpeechUserPreferences): Promise<SpeechUserPreferences>;
    labels?: {
        save?: string;
        speakers?: string;
        speakerName?: string;
        addSpeaker?: string;
        reset?: string;
    };
}
export declare function SpeechPreferencesForm({ initial, stt, tts, choices, speakerNames, onSave, labels, slots, className, }: SpeechPreferencesFormProps): import("react").JSX.Element;
