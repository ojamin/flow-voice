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
export function isVoiceOnFor(snapshot: VoiceModeSnapshot, chatId: string): boolean {
  return snapshot.enabled && (snapshot.scope === 'on-screen' || snapshot.chatId === chatId);
}
/** The chat whose new replies are read, from a snapshot. */
export function readingChatOf(snapshot: VoiceModeSnapshot): string | null {
  if (!snapshot.enabled) return null;
  return snapshot.scope === 'on-screen' ? snapshot.chatOnScreen : snapshot.chatId;
}

/** Ephemeral host-owned Voice preference. Voice itself never persists; hosts may persist the
 * scope through `onScopeChange` and pass it back as `scope`. */
export function createVoiceMode(options: {
  scope?: VoiceScope;
  onScopeChange?(scope: VoiceScope): void;
} = {}): VoiceMode {
  let snapshot: VoiceModeSnapshot = {
    enabled: false, scope: options.scope ?? 'one-chat', chatId: null, chatOnScreen: null,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<VoiceModeSnapshot>) => {
    const next = { ...snapshot, ...patch };
    if ((Object.keys(next) as (keyof VoiceModeSnapshot)[]).every((key) => next[key] === snapshot[key]))
      return;
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const mode: VoiceMode = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle: (chatId) => mode.setEnabled(chatId, !mode.isOnFor(chatId)),
    setEnabled(chatId, enabled) {
      if (snapshot.scope === 'on-screen') publish({ enabled, chatId });
      else if (enabled) publish({ enabled, chatId });
      else if (snapshot.chatId === chatId) publish({ enabled: false });
    },
    setScope(scope) {
      if (scope === snapshot.scope) return;
      const chatId = scope === 'one-chat' && snapshot.enabled
        ? snapshot.chatOnScreen ?? snapshot.chatId
        : snapshot.chatId;
      publish({ scope, chatId });
      options.onScopeChange?.(scope);
    },
    setChatOnScreen: (chatOnScreen) => publish({ chatOnScreen }),
    isOnFor: (chatId) => isVoiceOnFor(snapshot, chatId),
    isReadingFor: (chatOnScreen) => snapshot.enabled &&
      (snapshot.scope === 'on-screen' || snapshot.chatId === chatOnScreen),
    readingChat: () => readingChatOf(snapshot),
    enableFor(chatId) {
      const { enabled, chatId: previous } = snapshot;
      mode.setEnabled(chatId, true);
      return () => publish({ enabled, chatId: previous });
    },
  };
  return mode;
}
