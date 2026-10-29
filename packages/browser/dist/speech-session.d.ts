import { type DictationPreference } from '@flow-voice/core';
import { type ConversationMessages } from './auto-read/conversation.js';
import { type VoiceMode } from './voice-mode.js';
import { type CallSession } from './call-session.js';
import type { createAudioCapture } from './capture/capture.js';
import type { ComposerAdapter, DictationController, DictationTransport, SpeechPlayer, SynthesisFetcher } from './index.js';
export interface SpeechSessionConfig {
    stt: {
        enabled: boolean;
        sampleRates: readonly number[];
        defaults: {
            language?: string;
        };
    };
    tts: {
        enabled: boolean;
    };
}
export interface ComposerSpeech {
    dictation: DictationController;
    call: CallSession | null;
    dispose(): void;
}
export interface ComposerSpeechOptions {
    config(): SpeechSessionConfig;
    preferences(): DictationPreference & {
        language?: string;
    };
    activityTarget?: EventTarget;
}
export interface SpeechSession {
    readonly player: SpeechPlayer;
    readonly voiceMode: VoiceMode;
    readonly messages: ConversationMessages;
    currentConversation(): string | null;
    claimConversation(id: string): () => void;
    leaveSurface(): void;
    invalidateDrafts(): void;
    /** Bind only when STT is enabled and supportedDictationRate returns a rate. */
    bindComposer(composer: ComposerAdapter, options: ComposerSpeechOptions): ComposerSpeech;
    dispose(): void;
}
/** Shared admission/rate choice for imperative hosts and effect-owned React bindings. */
export declare function supportedDictationRate(config: SpeechSessionConfig): number | undefined;
/** Effect-owned composition. Transport, authenticated synthesis and activity source stay host-owned. */
export declare function createSpeechSession(options: {
    synthesize: SynthesisFetcher;
    createTransport(): DictationTransport;
    workletUrl: string | URL;
    capture?: typeof createAudioCapture;
    onConversationChange?(id: string | null): void;
}): SpeechSession;
