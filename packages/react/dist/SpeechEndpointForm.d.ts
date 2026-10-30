import type { SpeechEndpointDraft, SpeechEndpointView, SpeechEndpointWrite, SpeechKind, Voice } from '@flow-voice/core';
import type { SpeechControlAppearance } from './controls.js';
import type { VoiceChoiceState } from './VoiceSelect.js';
/** Accepts a server SpeechEndpointCheck verbatim, or the legacy host projection. */
export interface SpeechEndpointTestResult {
    ok?: true;
    voices?: readonly Voice[];
    tts?: {
        ok: true;
        voices: readonly Voice[];
    };
    stt?: {
        ok: true;
        verified: true;
        live?: boolean;
    };
    models?: string[];
    baseUrl?: string;
    voiceError?: string;
}
export interface SpeechEndpointFormProps extends SpeechControlAppearance {
    kind: SpeechKind;
    initial: SpeechEndpointView | null;
    providers: readonly {
        id: string;
        name: string;
    }[];
    choices?: VoiceChoiceState;
    onSave(value: SpeechEndpointWrite): Promise<SpeechEndpointView | null>;
    onTest(value: SpeechEndpointDraft): Promise<SpeechEndpointTestResult>;
    onErrorFields?(error: unknown): Readonly<Record<string, string>>;
    labels?: {
        save?: string;
        test?: string;
        clear?: string;
        reset?: string;
    };
}
export declare function SpeechEndpointForm({ kind, initial, providers, choices, onSave, onTest, onErrorFields, labels, slots, className, }: SpeechEndpointFormProps): import("react").JSX.Element;
