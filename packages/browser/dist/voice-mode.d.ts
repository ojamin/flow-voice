import type { ExternalStore } from './index.js';
export type VoiceScope = 'one-chat' | 'on-screen';
export interface VoiceModeSnapshot {
    enabled: boolean;
    scope: VoiceScope;
    chatId: string | null;
}
export interface VoiceMode extends ExternalStore<VoiceModeSnapshot> {
    toggle(currentChatId: string): void;
    setScope(scope: VoiceScope): void;
    isReadingFor(chatOnScreen: string): boolean;
}
/** Ephemeral host-owned Voice preference. Never writes to storage. */
export declare function createVoiceMode(options?: {
    scope?: VoiceScope;
}): VoiceMode;
