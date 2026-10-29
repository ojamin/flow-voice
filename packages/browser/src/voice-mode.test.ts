import { expect, it, vi } from 'vitest';
import { createVoiceMode, isVoiceOnFor, readingChatOf } from './index.js';

it('one chat at a time: turning Voice on elsewhere moves it, off elsewhere does nothing', () => {
  const mode = createVoiceMode();
  const listener = vi.fn();
  const unsubscribe = mode.subscribe(listener);
  expect(mode.getSnapshot()).toEqual({ enabled: false, scope: 'one-chat', chatId: null, chatOnScreen: null });
  mode.toggle('a');
  expect(mode.readingChat()).toBe('a');
  expect(mode.isOnFor('a')).toBe(true);
  expect(mode.isOnFor('b')).toBe(false);
  mode.setEnabled('b', false);
  expect(mode.isOnFor('a')).toBe(true);
  mode.toggle('b');
  expect(mode.isOnFor('a')).toBe(false);
  expect(mode.readingChat()).toBe('b');
  mode.setChatOnScreen('a');
  expect(mode.readingChat()).toBe('b');
  expect(mode.isReadingFor('a')).toBe(false);
  mode.toggle('b');
  expect(mode.readingChat()).toBeNull();
  unsubscribe();
  mode.toggle('b');
  expect(listener).toHaveBeenCalledTimes(4);
});

it('on-screen reads the chat shown, and switching scope keeps Voice on where you are', () => {
  const onScopeChange = vi.fn();
  const mode = createVoiceMode({ onScopeChange });
  mode.setChatOnScreen('a');
  mode.setEnabled('a', true);
  mode.setScope('on-screen');
  expect(onScopeChange).toHaveBeenLastCalledWith('on-screen');
  expect(mode.isOnFor('b')).toBe(true);
  mode.setChatOnScreen('b');
  expect(mode.readingChat()).toBe('b');
  expect(mode.isReadingFor('b')).toBe(true);
  mode.setScope('one-chat');
  expect(mode.readingChat()).toBe('b');
  expect(mode.isOnFor('a')).toBe(false);
  mode.setEnabled('b', false);
  mode.setScope('on-screen');
  expect(mode.readingChat()).toBeNull();
  mode.setScope('on-screen');
  expect(onScopeChange).toHaveBeenCalledTimes(3);
  expect(createVoiceMode({ scope: 'on-screen' }).getSnapshot().scope).toBe('on-screen');
});

it('enables Voice for a call and restores exactly what was before', () => {
  const mode = createVoiceMode();
  const restoreOff = mode.enableFor('a');
  expect(mode.readingChat()).toBe('a');
  restoreOff();
  expect(mode.getSnapshot()).toMatchObject({ enabled: false, chatId: null });
  mode.toggle('b');
  const restoreElsewhere = mode.enableFor('a');
  expect(mode.readingChat()).toBe('a');
  restoreElsewhere();
  expect(mode.readingChat()).toBe('b');
});

it('answers the same questions from a snapshot, for renders that must depend on it', () => {
  const mode = createVoiceMode();
  mode.toggle('a');
  const snapshot = mode.getSnapshot();
  expect(isVoiceOnFor(snapshot, 'a')).toBe(true);
  expect(isVoiceOnFor(snapshot, 'b')).toBe(false);
  expect(readingChatOf(snapshot)).toBe('a');
  expect(readingChatOf({ ...snapshot, enabled: false })).toBeNull();
});
