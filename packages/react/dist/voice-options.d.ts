import type { Voice } from '@flow-voice/core';
export interface VoiceChoiceState {
    voices: readonly Voice[];
    status: 'loading' | 'ready' | 'error';
    retry?(): void;
}
export declare function voiceOptions(value: string | undefined, choices: VoiceChoiceState, defaultLabel: string): {
    value: string;
    label: string;
    disabled: boolean;
}[];
