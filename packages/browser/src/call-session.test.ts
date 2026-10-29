import { expect, it, vi } from 'vitest';
import { createCallSession } from './index.js';
import type { CallMediaAction, CallMediaSession, DictationController, DictationSnapshot, SpeechPlayer, SpeechPlayerSnapshot } from './index.js';

function fixture(outcomes: boolean[] = []) {
  let dictationState: DictationSnapshot = {
    status: 'idle', committed: '', tentative: '', rms: 0, countdownMs: null, error: null,
  };
  const listeners = new Set<() => void>();
  const emit = (status: DictationSnapshot['status']) => {
    dictationState = { ...dictationState, status };
    listeners.forEach((listener) => listener());
  };
  const dictation: DictationController = {
    getSnapshot: () => dictationState,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    start: vi.fn(async () => {
      if (outcomes.shift() === false) { emit('error'); throw new Error('start failed'); }
      emit('listening');
    }),
    cancel: vi.fn(async () => { emit('idle'); }),
    finish: vi.fn(async () => { emit('idle'); }),
    dispose: vi.fn(async () => {}), cancelAutoSend: vi.fn(), notifyUserActivity: vi.fn(),
  };
  let playerStatus: SpeechPlayerSnapshot['status'] = 'idle';
  let playerListener = () => {};
  const player: SpeechPlayer = {
    getSnapshot: () => ({ status: playerStatus, messageId: null, sectionOrdinal: null, queuedMessages: 0, error: null }),
    subscribe(fn) { playerListener = fn; return vi.fn(); },
    unlock: vi.fn(async () => {}), setBackgroundAudio: vi.fn(async () => {}),
    resume: vi.fn(async () => { playerStatus = 'playing'; playerListener(); }),
    pause: vi.fn(() => { playerStatus = 'paused'; playerListener(); }),
    skipSection: vi.fn(), skipToEnd: vi.fn(), stop: vi.fn(), dispose: vi.fn(), enqueue: vi.fn(), append: vi.fn(),
  };
  const handlers = new Map<MediaSessionAction | CallMediaAction, (() => void) | null>();
  const media: CallMediaSession = {
    playbackState: 'none',
    setActionHandler: vi.fn((action, handler) => { handlers.set(action, handler); }),
    setMicrophoneActive: vi.fn(() => undefined),
  };
  const restore = vi.fn();
  const onVoiceChange = vi.fn(() => restore);
  const session = createCallSession({ dictation, player, mediaSession: media, onVoiceChange });
  return { session, dictation, player, emit, media, handlers, restore, onVoiceChange };
}

it('starts gesture-sensitive APIs synchronously, restarts stops/errors, mutes and restores Voice', async () => {
  const f = fixture();
  const start = f.session.start();
  expect(f.dictation.start).toHaveBeenCalledTimes(1);
  expect(f.player.unlock).toHaveBeenCalledTimes(1);
  expect(f.player.setBackgroundAudio).toHaveBeenCalledWith(true);
  await start;
  f.emit('idle');
  await vi.waitFor(() => expect(f.dictation.start).toHaveBeenCalledTimes(2));
  f.emit('error');
  await vi.waitFor(() => expect(f.dictation.start).toHaveBeenCalledTimes(3));
  f.session.setMuted(true);
  expect(f.session.getSnapshot()).toEqual({ status: 'active', muted: true });
  await Promise.resolve();
  expect(f.dictation.start).toHaveBeenCalledTimes(3);
  f.session.setMuted(false);
  await vi.waitFor(() => expect(f.dictation.start).toHaveBeenCalledTimes(4));
  f.session.end();
  expect(f.restore).toHaveBeenCalledTimes(1);
  expect(f.onVoiceChange).toHaveBeenCalledTimes(1);
  expect(f.player.setBackgroundAudio).toHaveBeenLastCalledWith(false);
  expect(f.session.getSnapshot()).toEqual({ status: 'idle', muted: false });
  f.session.dispose();
  expect(f.restore).toHaveBeenCalledTimes(1);
});

it('ends after three consecutive failures, resetting the count on a successful listen', async () => {
  const f = fixture([false, false, true, false, false, false]);
  await f.session.start();
  await vi.waitFor(() => expect(f.dictation.start).toHaveBeenCalledTimes(3));
  expect(f.session.getSnapshot().status).toBe('active');
  f.emit('idle');
  await vi.waitFor(() => expect(f.session.getSnapshot().status).toBe('idle'));
  expect(f.dictation.start).toHaveBeenCalledTimes(6);
  expect(f.restore).toHaveBeenCalledTimes(1);
  f.session.dispose();
});

it('waits for submission finalization before restarting capture', async () => {
  const f = fixture();
  await f.session.start();
  f.emit('finalizing');
  await Promise.resolve();
  expect(f.dictation.start).toHaveBeenCalledTimes(1);
  f.emit('idle');
  await vi.waitFor(() => expect(f.dictation.start).toHaveBeenCalledTimes(2));
  f.session.dispose();
});

it('counts controller error snapshots even when start resolves rather than rejects', async () => {
  const f = fixture();
  vi.mocked(f.dictation.start).mockImplementation(async () => { f.emit('error'); });
  await f.session.start();
  await vi.waitFor(() => expect(f.session.getSnapshot().status).toBe('idle'));
  expect(f.dictation.start).toHaveBeenCalledTimes(3);
  f.session.dispose();
});

it('does not count a successful listen followed immediately by provider end as a start failure', async () => {
  const f = fixture();
  vi.mocked(f.dictation.start)
    .mockImplementationOnce(async () => { f.emit('listening'); f.emit('idle'); })
    .mockImplementationOnce(async () => { f.emit('listening'); f.emit('idle'); })
    .mockImplementationOnce(async () => { f.emit('listening'); f.emit('idle'); });
  await f.session.start();
  await vi.waitFor(() => expect(f.dictation.start).toHaveBeenCalledTimes(4));
  expect(f.session.getSnapshot().status).toBe('active');
  f.session.dispose();
});

it('installs and clears media controls, including synchronous microphone capability', async () => {
  const f = fixture();
  await f.session.start();
  expect(f.media.setMicrophoneActive).toHaveBeenLastCalledWith(true);
  expect(f.handlers.size).toBe(5);
  f.handlers.get('play')!();
  expect(f.media.playbackState).toBe('playing');
  f.handlers.get('pause')!();
  expect(f.media.playbackState).toBe('paused');
  f.handlers.get('nexttrack')!();
  expect(f.player.skipSection).toHaveBeenCalledTimes(1);
  f.handlers.get('togglemicrophone')!();
  expect(f.media.setMicrophoneActive).toHaveBeenLastCalledWith(false);
  f.handlers.get('hangup')!();
  expect([...f.handlers.values()]).toEqual([null, null, null, null, null]);
  expect(f.media.playbackState).toBe('none');
  f.session.dispose();
});

it('ignores unsupported individual media actions and cleans up on dispose', async () => {
  const f = fixture();
  vi.mocked(f.media.setActionHandler).mockImplementation((action, handler) => {
    if (action === 'hangup') throw new Error('unsupported');
    f.handlers.set(action, handler);
  });
  await f.session.start();
  expect(f.handlers.has('togglemicrophone')).toBe(true);
  f.session.dispose();
  expect(f.restore).toHaveBeenCalledTimes(1);
  expect(f.player.setBackgroundAudio).toHaveBeenLastCalledWith(false);
});
