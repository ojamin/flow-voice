import { expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import type { CallSession, VoiceMode } from '@flow-voice/browser';
import { useCallSession, useVoiceMode } from './index.js';

vi.mock('react', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  useSyncExternalStore: vi.fn((_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot()),
}));

it('subscribes to host-owned call and Voice stores without owning their lifecycle', () => {
  const call: CallSession = {
    getSnapshot: () => ({ status: 'active', muted: true }), subscribe: vi.fn(() => vi.fn()),
    start: vi.fn(async () => {}), end: vi.fn(), setMuted: vi.fn(), dispose: vi.fn(),
  };
  const mode: VoiceMode = {
    getSnapshot: () => ({ enabled: true, scope: 'one-chat', chatId: 'a' }),
    subscribe: vi.fn(() => vi.fn()), toggle: vi.fn(), setScope: vi.fn(), isReadingFor: vi.fn(),
  };
  expect(useCallSession(call)).toEqual({ status: 'active', muted: true });
  expect(useSyncExternalStore).toHaveBeenCalledWith(call.subscribe, call.getSnapshot, call.getSnapshot);
  expect(useVoiceMode(mode)).toEqual({ enabled: true, scope: 'one-chat', chatId: 'a' });
  expect(useSyncExternalStore).toHaveBeenCalledWith(mode.subscribe, mode.getSnapshot, mode.getSnapshot);
  expect(call.start).not.toHaveBeenCalled();
  expect(call.dispose).not.toHaveBeenCalled();
});
