// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { DictationController, DictationSnapshot } from '@flow-voice/browser';
import { MicButton } from './MicButton.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = '';
});
it('renders native accessible controls, updates external state, and exposes cancellable countdown', async () => {
  let snapshot: DictationSnapshot = {
    status: 'idle',
    committed: '',
    tentative: '',
    rms: 0,
    countdownMs: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  const controller: DictationController = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    start: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    dispose: vi.fn(async () => {}),
    cancelAutoSend: vi.fn(),
    notifyUserActivity: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MicButton controller={controller} showLevel className="host-button" />);
  });
  const button = host.querySelector('button')!;
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.textContent).toBe('Start dictation');
  await act(async () => {
    button.click();
  });
  expect(controller.start).toHaveBeenCalledOnce();
  await act(async () => {
    snapshot = { ...snapshot, status: 'listening', rms: 0.4, countdownMs: 1200 };
    listeners.forEach((listener) => listener());
  });
  expect(button.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('meter')?.value).toBe(0.4);
  expect(host.textContent).toContain('Sending in 2 seconds');
  await act(async () => {
    snapshot = { ...snapshot, countdownMs: 800 };
    listeners.forEach((listener) => listener());
  });
  expect(host.textContent).toContain('Sending in 1 second');
  expect(host.textContent).not.toContain('1 seconds');
  await act(async () => {
    host.querySelectorAll('button')[1].click();
    button.click();
  });
  expect(controller.cancelAutoSend).toHaveBeenCalledOnce();
  expect(controller.finish).toHaveBeenCalledOnce();
  await act(async () => {
    snapshot = { ...snapshot, status: 'finalizing' };
    listeners.forEach((listener) => listener());
  });
  expect(button.disabled).toBe(true);
  await act(async () => {
    snapshot = {
      ...snapshot,
      status: 'error',
      error: { code: 'unauthorized', message: 'Allow microphone access' },
      countdownMs: null,
    };
    listeners.forEach((listener) => listener());
  });
  expect(host.querySelector('[role=status]')?.textContent).toBe('Allow microphone access');
  await act(async () => {
    root.unmount();
  });
  expect(listeners.size).toBe(0);
  expect(controller.dispose).not.toHaveBeenCalled();
});
