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
export function createVoiceMode(options: { scope?: VoiceScope } = {}): VoiceMode {
  let snapshot: VoiceModeSnapshot = {
    enabled: false, scope: options.scope ?? 'one-chat', chatId: null,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<VoiceModeSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    toggle: (chatId) => publish({ enabled: !snapshot.enabled, chatId }),
    setScope: (scope) => publish({ scope }),
    isReadingFor: (chatId) => snapshot.enabled &&
      (snapshot.scope === 'on-screen' || snapshot.chatId === chatId),
  };
}
