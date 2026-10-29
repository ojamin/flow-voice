// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_DICTATION_PREFERENCE, type SttServerMessage } from '@flow-voice/core';
import { createAutoReader, createSpeechSession, createTextareaComposerAdapter, readAloud, supportedDictationRate,
  type DictationTransport, type SpeechSessionConfig } from './index.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function fixture(tts = true) {
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    resume = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createMediaStreamDestination() { return { stream: {} }; }
  });
  vi.stubGlobal('Audio', class {
    srcObject: unknown;
    play = vi.fn(async () => {});
    pause = vi.fn();
  });
  let receive!: (message: SttServerMessage) => void;
  const createTransport = vi.fn((): DictationTransport => ({
    connect: async (options) => { receive = options.onMessage; },
    send: async (message) => {
      if (message.type === 'start') receive({ type: 'ready', audio: message.audio, interim: true });
      if (message.type === 'stop') {
        receive({ type: 'final', revision: 100, text: 'final' });
        receive({ type: 'ended', reason: 'stopped' });
      }
    },
    close: vi.fn(),
  }));
  const capture = { start: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
  const changed = vi.fn();
  const session = createSpeechSession({
    synthesize: async () => ({ stream: new ReadableStream(), mimeType: 'audio/pcm',
      format: { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } }),
    createTransport, capture: () => capture, workletUrl: '/worklet.js', onConversationChange: changed,
  });
  cleanups.push(() => session.dispose());
  const element = document.createElement('textarea');
  const submitted = vi.fn(async () => {});
  const composer = createTextareaComposerAdapter({ element, canSubmit: () => true, submit: submitted });
  cleanups.push(() => composer.dispose());
  const config: SpeechSessionConfig = {
    stt: { enabled: true, sampleRates: [123, 24000], defaults: {} }, tts: { enabled: tts },
  };
  let preferences = { ...DEFAULT_DICTATION_PREFERENCE };
  const bind = () => session.bindComposer(composer, {
    config: () => config, preferences: () => preferences, activityTarget: document,
  });
  return { session, config, capture, element, composer, submitted, changed, createTransport, bind,
    emit: (message: SttServerMessage) => receive(message),
    preferences: (next: typeof preferences) => { preferences = next; } };
}

it.each([true, false])('releases overlapping claims in either order (old first: %s)', (oldFirst) => {
  const f = fixture();
  const releaseA = f.session.claimConversation('a');
  const releaseB = f.session.claimConversation('b');
  expect(f.session.currentConversation()).toBe('b');
  (oldFirst ? releaseA : releaseB)();
  expect(f.session.currentConversation()).toBe(oldFirst ? 'b' : 'a');
  (oldFirst ? releaseB : releaseA)();
  expect(f.session.currentConversation()).toBeNull();
  releaseB();
  expect(f.changed.mock.calls.map(([id]) => id)).toEqual(oldFirst ? ['a', 'b', null] : ['a', 'b', 'a', null]);
});

it('keeps same-identity claims active until the last release', async () => {
  const f = fixture();
  const releaseA = f.session.claimConversation('a');
  const releaseB = f.session.claimConversation('a');
  const binding = f.bind();
  await binding.dictation.start();
  releaseB();
  expect(binding.dictation.getSnapshot().status).toBe('listening');
  releaseA();
  expect(binding.dictation.getSnapshot().status).toBe('idle');
  expect(f.capture.stop).toHaveBeenCalled();
});

it.each(['conversation', 'release', 'surface', 'dispose'] as const)('%s ends input and ordinary playback', async (change) => {
  const f = fixture();
  const release = f.session.claimConversation('a');
  const binding = f.bind();
  await binding.dictation.start();
  readAloud(f.session.player, { id: 'reply', markdown: 'hello' });
  expect(f.session.player.getSnapshot().status).toBe('loading');
  if (change === 'conversation') f.session.claimConversation('b');
  else if (change === 'release') release();
  else if (change === 'surface') f.session.leaveSurface();
  else f.session.dispose();
  expect(binding.dictation.getSnapshot().status).toBe('idle');
  expect(f.capture.stop).toHaveBeenCalled();
  expect(f.session.player.getSnapshot().status).toBe('idle');
});

it.each(['automatic', 'manual'] as const)('%s playback and queue controls leave dictation listening', async (mode) => {
  const f = fixture();
  f.session.claimConversation('a');
  const binding = f.bind();
  await binding.dictation.start();
  if (mode === 'automatic') {
    f.session.voiceMode.setEnabled('a', true);
    const reader = createAutoReader({ player: f.session.player, messages: f.session.messages, enabled: true });
    cleanups.push(() => reader.dispose());
    f.session.messages.publish({ conversation: 'a', source: 'live', message: {
      id: 'reply', markdown: 'hello', own: false, complete: true,
    } });
  } else readAloud(f.session.player, { id: 'reply', markdown: 'hello' });
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  readAloud(f.session.player, { id: 'next', markdown: 'next' });
  expect(f.session.player.getSnapshot().queuedMessages).toBe(2);
  f.session.player.skipToEnd();
  await vi.waitFor(() => expect(f.session.player.getSnapshot()).toMatchObject({ status: 'playing', messageId: 'next' }));
  expect(binding.dictation.getSnapshot().status).toBe('listening');
  expect(f.capture.stop).not.toHaveBeenCalled();
});

it.each(['one-chat', 'on-screen'] as const)('route changes preserve only pinned %s playback and refresh audience', (scope) => {
  const f = fixture();
  f.session.claimConversation('a');
  f.session.voiceMode.setScope(scope);
  f.session.voiceMode.setEnabled('a', true);
  const arrivals: string[] = [];
  f.session.messages.subscribe(({ message }) => arrivals.push(message.id));
  const finish = f.session.messages.beforeRefresh('a', [], true);
  readAloud(f.session.player, { id: 'reply', markdown: 'hello' });
  f.session.leaveSurface();
  f.session.claimConversation('b');
  finish([{ id: 'fresh', ordinal: 1, own: false, complete: true, markdown: 'new' }]);
  expect(f.session.player.getSnapshot().status).toBe(scope === 'one-chat' ? 'loading' : 'idle');
  expect(arrivals).toEqual(scope === 'one-chat' ? ['fresh'] : []);
});

it('invalidates drafts synchronously before a controlled replacement and rejects late words', async () => {
  const f = fixture();
  const binding = f.bind();
  await binding.dictation.start();
  f.emit({ type: 'partial', revision: 1, committed: 'old', tentative: 'draft' });
  f.session.invalidateDrafts();
  expect(binding.dictation.getSnapshot().status).toBe('idle');
  f.element.value = 'replacement';
  f.emit({ type: 'final', revision: 2, text: 'late final' });
  expect(f.element.value).toBe('replacement');
});

it('reads latest preferences without rebuilding the controller', async () => {
  vi.useFakeTimers();
  const f = fixture(false);
  const binding = f.bind();
  expect(binding.call).toBeNull();
  await binding.dictation.start();
  f.preferences({ ...DEFAULT_DICTATION_PREFERENCE, sendAfterPause: true, silenceMs: 300, stopAfterSend: true });
  f.emit({ type: 'partial', revision: 1, committed: 'hello', tentative: '' });
  await vi.advanceTimersByTimeAsync(700);
  expect(f.submitted).toHaveBeenCalledOnce();
  expect(binding.dictation.getSnapshot().status).toBe('idle');
  expect(f.createTransport).toHaveBeenCalledOnce();
});

it('restores Voice on call end and ends calls before cancelling route input', async () => {
  const f = fixture();
  f.session.claimConversation('a');
  f.session.voiceMode.setEnabled('pinned', true);
  const binding = f.bind();
  await binding.call!.start();
  expect(f.session.voiceMode.readingChat()).toBe('a');
  f.session.leaveSurface();
  expect(binding.call!.getSnapshot().status).toBe('idle');
  expect(binding.dictation.getSnapshot().status).toBe('idle');
  expect(f.session.voiceMode.readingChat()).toBe('pinned');
});

it('disposes bindings idempotently, unregistering activity and draft invalidation', async () => {
  const f = fixture();
  const binding = f.bind();
  const activity = vi.spyOn(binding.dictation, 'notifyUserActivity');
  document.dispatchEvent(new Event('keydown'));
  expect(activity).toHaveBeenCalledOnce();
  binding.dispose();
  binding.dispose();
  document.dispatchEvent(new Event('keydown'));
  const cancel = vi.spyOn(binding.dictation, 'cancel');
  f.session.invalidateDrafts();
  expect(activity).toHaveBeenCalledOnce();
  expect(cancel).not.toHaveBeenCalled();
  const next = f.bind();
  await next.dictation.start();
  expect(next.dictation.getSnapshot().status).toBe('listening');
});

it('does not construct transport for disabled or unsupported capture', () => {
  const f = fixture();
  f.config.stt.sampleRates = [123];
  expect(supportedDictationRate(f.config)).toBeUndefined();
  expect(f.bind).toThrow('Dictation is unavailable');
  f.config.stt.sampleRates = [24000];
  f.config.stt.enabled = false;
  expect(f.bind).toThrow('Dictation is unavailable');
  expect(f.createTransport).not.toHaveBeenCalled();
});
