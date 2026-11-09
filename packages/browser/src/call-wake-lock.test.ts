// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createCallSession, createSpeechPlayer } from './index.js';

let visible = true;
const sessions: ReturnType<typeof createCallSession>[] = [];
afterEach(() => {
  sessions.splice(0).forEach((session) => session.dispose());
  vi.unstubAllGlobals();
  visible = true;
});
function fixture(request = vi.fn(async () => ({ release: vi.fn(async () => {}) }))) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
  vi.stubGlobal('navigator', { wakeLock: { request } });
  const player = createSpeechPlayer({ synthesize: vi.fn() });
  vi.spyOn(player, 'unlock').mockResolvedValue();
  vi.spyOn(player, 'setBackgroundAudio').mockResolvedValue();
  const session = createCallSession({ dictation: null, player, mediaSession: null });
  sessions.push(session);
  return { session, request };
}
function visibility(value: boolean) {
  visible = value;
  document.dispatchEvent(new Event('visibilitychange'));
}
it('owns screen wake lock only during a visible call, reacquires on visible and releases on end/dispose', async () => {
  const f = fixture();
  expect(f.request).not.toHaveBeenCalled();
  await f.session.start();
  expect(f.request).toHaveBeenCalledWith('screen');
  const first = await f.request.mock.results[0]!.value;
  visibility(false);
  expect(first.release).toHaveBeenCalledTimes(1);
  visibility(true);
  await Promise.resolve();
  expect(f.request).toHaveBeenCalledTimes(2);
  const second = await f.request.mock.results[1]!.value;
  f.session.end();
  expect(second.release).toHaveBeenCalledTimes(1);
  visibility(true);
  expect(f.request).toHaveBeenCalledTimes(2);
  await f.session.start();
  const third = await f.request.mock.results[2]!.value;
  f.session.dispose();
  expect(third.release).toHaveBeenCalledTimes(1);
});
it.each(['hide', 'end', 'dispose'] as const)('releases a late wake-lock request after %s', async (action) => {
  let resolve!: (value: { release: ReturnType<typeof vi.fn<() => Promise<void>>> }) => void;
  const request = vi.fn(() => new Promise<{ release: ReturnType<typeof vi.fn<() => Promise<void>>> }>((done) => { resolve = done; }));
  const f = fixture(request);
  await f.session.start();
  if (action === 'hide') visibility(false);
  else f.session[action]();
  const release = vi.fn(async () => {});
  resolve({ release });
  await Promise.resolve();
  expect(release).toHaveBeenCalledTimes(1);
});
it('does not let an old late request replace the visible call\'s new lock', async () => {
  const oldLock = { release: vi.fn(async () => {}) };
  const newLock = { release: vi.fn(async () => {}) };
  let resolve!: (lock: typeof oldLock) => void;
  const request = vi.fn(async () => newLock);
  request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const f = fixture(request);
  await f.session.start();
  visibility(false);
  visibility(true);
  await Promise.resolve();
  resolve(oldLock);
  await Promise.resolve();
  expect(oldLock.release).toHaveBeenCalledTimes(1);
  expect(newLock.release).not.toHaveBeenCalled();
  f.session.end();
  expect(newLock.release).toHaveBeenCalledTimes(1);
});
it('does not request while hidden; denial and unsupported browsers do not fail the call', async () => {
  const f = fixture(vi.fn(async () => { throw new Error('denied'); }));
  visibility(false);
  await f.session.start();
  expect(f.request).not.toHaveBeenCalled();
  visibility(true);
  await Promise.resolve();
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.session.getSnapshot().status).toBe('active');
  f.session.end();
  vi.stubGlobal('navigator', {});
  const unsupported = fixture();
  vi.stubGlobal('navigator', {});
  await unsupported.session.start();
  expect(unsupported.session.getSnapshot().status).toBe('active');
});
