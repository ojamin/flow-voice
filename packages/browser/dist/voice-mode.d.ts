import type { ExternalStore } from './index.js';
export type VoiceScope = 'one-chat' | 'on-screen';
export interface VoiceModeSnapshot {
    enabled: boolean;
    scope: VoiceScope;
    /** The chat one-chat Voice belongs to. */
    chatId: string | null;
    /** The chat last shown, kept while a non-chat page (such as settings) is open. */
    chatOnScreen: string | null;
}
export interface VoiceMode extends ExternalStore<VoiceModeSnapshot> {
    /** The chat's Voice button: on in another chat moves one-chat Voice here. */
    toggle(chatId: string): void;
    /** On moves one-chat Voice to `chatId`; off from another chat leaves it where it is. */
    setEnabled(chatId: string, enabled: boolean): void;
    /** Voice stays on or off; switching to one-chat while on keeps reading the chat on screen. */
    setScope(scope: VoiceScope): void;
    setChatOnScreen(chatId: string): void;
    /** Whether the chat's Voice button shows on (on-screen Voice is on for every chat). */
    isOnFor(chatId: string): boolean;
    /** Whether new replies in the chat on screen are read. */
    isReadingFor(chatOnScreen: string): boolean;
    /** The chat whose new replies are read, if any. */
    readingChat(): string | null;
    /** Turn Voice on for a chat (for a call) and return a restore of the previous state. */
    enableFor(chatId: string): () => void;
}
/** Whether the chat's Voice button shows on, from a snapshot. React hosts (especially with
 * the React Compiler) should read through these with `useVoiceMode`'s snapshot so renders
 * depend on it. */
export declare function isVoiceOnFor(snapshot: VoiceModeSnapshot, chatId: string): boolean;
/** The chat whose new replies are read, from a snapshot. */
export declare function readingChatOf(snapshot: VoiceModeSnapshot): string | null;
/** Ephemeral host-owned Voice preference. Voice itself never persists; hosts may persist the
 * scope through `onScopeChange` and pass it back as `scope`. */
export declare function createVoiceMode(options?: {
    scope?: VoiceScope;
    onScopeChange?(scope: VoiceScope): void;
}): VoiceMode;
