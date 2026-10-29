import { expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import type { CallSession, VoiceMode } from '@flow-voice/browser';
import { createSpeechPreferences } from '@flow-voice/browser';
import { useCallSession, useDictationPreference, useVoiceMode, useVoicePreference } from './index.js';

vi.mock('react', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSyncExternalStore: vi.fn((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()),
}));

it('subscribes to host-owned call and Voice stores without owning their lifecycle', () => {
  const call: CallSession = {
    getSnapshot: () => ({ status: 'active', muted: true, failed: false }), subscribe: vi.fn(() => vi.fn()),
    start: vi.fn(async () => {}), end: vi.fn(), setMuted: vi.fn(), setDictation: vi.fn(), dispose: vi.fn(),
  };
  const mode: VoiceMode = {
    getSnapshot: () => ({ enabled: true, scope: 'one-chat', chatId: 'a', chatOnScreen: null }),
    subscribe: vi.fn(() => vi.fn()), toggle: vi.fn(), setEnabled: vi.fn(), setScope: vi.fn(),
    setChatOnScreen: vi.fn(), isOnFor: vi.fn(), isReadingFor: vi.fn(), readingChat: vi.fn(), enableFor: vi.fn(),
  };
  expect(useCallSession(call)).toEqual({ status: 'active', muted: true, failed: false });
  expect(useSyncExternalStore).toHaveBeenCalledWith(call.subscribe, call.getSnapshot, call.getSnapshot);
  expect(useVoiceMode(mode)).toEqual({ enabled: true, scope: 'one-chat', chatId: 'a', chatOnScreen: null });
  expect(useSyncExternalStore).toHaveBeenCalledWith(mode.subscribe, mode.getSnapshot, mode.getSnapshot);
  expect(call.start).not.toHaveBeenCalled();
  expect(call.dispose).not.toHaveBeenCalled();
});

it('reads speech preferences for a scope from the host store', () => {
  const preferences = createSpeechPreferences({ storage: null });
  preferences.setVoice('env', 'nova');
  expect(useVoicePreference(preferences, 'env')).toBe('nova');
  expect(useDictationPreference(preferences, 'env').silenceMs).toBe(1500);
});
