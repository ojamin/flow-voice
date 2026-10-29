import { expect, it, vi } from 'vitest';
import { createVoiceMode } from './index.js';

it('binds one-chat Voice to its enabling chat and follows the screen only on request', () => {
  const mode = createVoiceMode();
  const listener = vi.fn();
  const unsubscribe = mode.subscribe(listener);
  const initial = mode.getSnapshot();
  expect(mode.isReadingFor('a')).toBe(false);
  mode.toggle('a');
  expect(initial.enabled).toBe(false);
  expect(mode.getSnapshot()).toEqual({ enabled: true, scope: 'one-chat', chatId: 'a' });
  expect(mode.isReadingFor('a')).toBe(true);
  expect(mode.isReadingFor('b')).toBe(false);
  mode.setScope('on-screen');
  expect(mode.isReadingFor('b')).toBe(true);
  mode.setScope('one-chat');
  expect(mode.isReadingFor('b')).toBe(false);
  mode.toggle('b');
  expect(mode.isReadingFor('a')).toBe(false);
  mode.toggle('b');
  expect(mode.isReadingFor('b')).toBe(true);
  expect(createVoiceMode({ scope: 'on-screen' }).getSnapshot().enabled).toBe(false);
  unsubscribe();
  mode.toggle('b');
  expect(listener).toHaveBeenCalledTimes(5);
});
