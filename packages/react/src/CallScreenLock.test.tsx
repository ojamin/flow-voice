// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CallSession, CallSessionSnapshot } from '@flow-voice/browser';
import { CallScreenLock } from './index.js';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  });
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  let state: CallSessionSnapshot = { status: 'active', muted: false, failed: false };
  const listeners = new Set<() => void>();
  const update = (status: CallSessionSnapshot['status']) => act(() => {
    state = { ...state, status };
    listeners.forEach((listener) => listener());
  });
  const call: CallSession = {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    start: vi.fn(async () => {}), end: vi.fn(() => update('idle')),
    setMuted: vi.fn(), setDictation: vi.fn(), failSubmission: vi.fn(), dispose: vi.fn(),
  };
  const view = render(<><button>Background send</button><CallScreenLock call={call} /></>);
  const lock = () => fireEvent.click(screen.getByRole('button', { name: 'Lock call screen' }));
  const thumb = () => screen.getByRole('button', { name: 'Unlock call screen' });
  const gesture = () => {
    lock();
    const button = thumb();
    vi.spyOn(button.parentElement!, 'getBoundingClientRect').mockReturnValue({ width: 320 } as DOMRect);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ width: 48 } as DOMRect);
    return button;
  };
  const pointer = (button: HTMLElement, type: string, x: number, extra = {}) => fireEvent(button, new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, button: 0, clientX: x, ...extra,
  }));
  return { call, view, update, lock, thumb, gesture, pointer };
}
it('uses a viewport modal, keeps the call running, blocks dismissal, and resets after call end', () => {
  const f = fixture();
  f.lock();
  const dialog = screen.getByRole('dialog', { name: 'Call screen locked' });
  expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledTimes(1);
  expect((dialog as HTMLDialogElement).open).toBe(true);
  expect(dialog.style.background).toBe('rgb(0, 0, 0)');
  expect(fireEvent(dialog, new Event('cancel', { cancelable: true }))).toBe(false);
  expect(f.call.end).not.toHaveBeenCalled();
  expect(f.call.setMuted).not.toHaveBeenCalled();
  f.update('idle');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Lock call screen' })).toBeNull();
  f.update('active');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Lock call screen' })).toBeTruthy();
});
it('unlocks only after primary thumb capture, long traversal and endpoint release', () => {
  const f = fixture();
  const thumb = f.gesture();
  f.pointer(thumb, 'pointerdown', 10);
  expect(thumb.setPointerCapture).toHaveBeenCalledWith(1);
  f.pointer(thumb, 'pointermove', 275);
  f.pointer(thumb, 'pointerup', 275);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(f.call.end).not.toHaveBeenCalled();
});
it.each(['tap', 'short', 'cancel', 'lost capture', 'second finger', 'endpoint only', 'return from endpoint', 'non-primary', 'secondary button', 'track tap'])('%s remains locked', (kind) => {
  const f = fixture();
  const thumb = f.gesture();
  if (kind === 'track tap') {
    f.pointer(thumb.parentElement!, 'pointerdown', 275);
    f.pointer(thumb.parentElement!, 'pointerup', 275);
  } else {
    f.pointer(thumb, 'pointerdown', 10, { isPrimary: kind !== 'non-primary', button: kind === 'secondary button' ? 2 : 0 });
    if (kind !== 'tap' && kind !== 'endpoint only') f.pointer(thumb, 'pointermove', kind === 'short' ? 50 : 275);
    if (kind === 'cancel') f.pointer(thumb, 'pointercancel', 275);
    if (kind === 'lost capture') f.pointer(thumb, 'lostpointercapture', 275);
    if (kind === 'second finger') f.pointer(thumb, 'pointerdown', 275, { pointerId: 2, isPrimary: false });
    f.pointer(thumb, 'pointerup', kind === 'tap' ? 10 : kind === 'short' || kind === 'return from endpoint' ? 50 : 275);
    fireEvent.click(thumb, { detail: 1 });
  }
  expect(screen.getByRole('dialog')).toBeTruthy();
});
it('offers an explicit keyboard/AT unlock and closes the modal on unmount', async () => {
  const user = userEvent.setup();
  const f = fixture();
  f.lock();
  f.thumb().focus();
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog')).toBeNull();
  f.lock();
  fireEvent.click(f.thumb(), { detail: 0 });
  expect(screen.queryByRole('dialog')).toBeNull();
  f.lock();
  f.view.unmount();
  expect(HTMLDialogElement.prototype.close).toHaveBeenCalled();
});
