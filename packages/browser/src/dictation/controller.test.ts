// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeSttClientMessage,
  decodeSttServerMessage,
  encodeSttClientMessage,
  encodeSttServerMessage,
} from '@flow-voice/core';
import type { SttServerMessage } from '@flow-voice/core';
import { createDictationController, createTextareaComposerAdapter } from '../index.js';
import type { AudioCaptureOptions, DictationController, DictationTransport } from '../index.js';

const controllers: DictationController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  vi.useRealTimers();
  document.body.innerHTML = '';
});
function fixture(autoSend?: { enabled: boolean; silenceMs: number; keyword?: string }) {
  const element = document.createElement('textarea');
  element.value = 'before after';
  element.setSelectionRange(7, 7);
  document.body.append(element);
  const submitted: string[] = [];
  const submit = vi.fn(async () => {
    submitted.push(element.value);
  });
  let allowed = true;
  const composer = createTextareaComposerAdapter({ element, canSubmit: () => allowed, submit });
  let handlers!: Parameters<DictationTransport['connect']>[0];
  const emit = (event: SttServerMessage) =>
    handlers.onMessage(decodeSttServerMessage(encodeSttServerMessage(event)));
  let final = 'hello world';
  let autoEnd = true;
  const transport: DictationTransport = {
    connect: vi.fn(async (value) => {
      handlers = value;
    }),
    send: vi.fn(async (value) => {
      const message = decodeSttClientMessage(encodeSttClientMessage(value));
      if (message.type === 'start') emit({ type: 'ready', audio: message.audio, interim: true });
      if (message.type === 'stop' && autoEnd) {
        emit({ type: 'final', revision: 100, text: final });
        emit({ type: 'ended', reason: 'stopped' });
      }
    }),
    close: vi.fn(),
  };
  let captureOptions!: AudioCaptureOptions;
  const stop = vi.fn(async () => {});
  const capture = vi.fn((value: AudioCaptureOptions) => {
    captureOptions = value;
    return { start: async () => {}, stop };
  });
  const controller = createDictationController({
    composer,
    transport,
    capture,
    audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    autoSend,
  });
  controllers.push(controller);
  return {
    controller,
    composer,
    element,
    emit,
    transport,
    stop,
    submit,
    submitted,
    capture,
    get captureOptions() {
      return captureOptions;
    },
    setFinal(value: string) {
      final = value;
    },
    setAllowed(value: boolean) {
      allowed = value;
    },
    deferEnd() {
      autoEnd = false;
    },
  };
}
const partial = (revision: number, committed: string, tentative: string): SttServerMessage => ({
  type: 'partial',
  revision,
  committed,
  tentative,
});

describe('dictation transaction', () => {
  it('replaces revisioned partials at the original caret, not the current caret; final is complete session text', async () => {
    const f = fixture();
    await f.controller.start();
    f.element.setSelectionRange(0, 0);
    f.emit(partial(2, 'hello', 'wor'));
    f.emit(partial(1, '', 'stale'));
    expect(f.element.value).toBe('before hello worafter');
    await f.controller.finish();
    expect(f.element.value).toBe('before hello worldafter');
    expect(f.controller.getSnapshot().status).toBe('idle');
    expect(f.stop).toHaveBeenCalled();
    expect(f.transport.close).toHaveBeenCalledTimes(1);
  });
  it('maps edits before/after insertion and never overwrites a user correction inside it', async () => {
    const f = fixture();
    await f.controller.start();
    f.emit(partial(1, 'hello', ''));
    f.element.value = 'Xbefore helloafter';
    f.element.dispatchEvent(new Event('input'));
    f.emit(partial(2, 'hello world', ''));
    expect(f.element.value).toBe('Xbefore hello worldafter');
    f.element.value = 'Xbefore HELLO worldafter!';
    f.element.dispatchEvent(new Event('input'));
    f.emit(partial(3, 'hello world again', ''));
    expect(f.element.value).toContain('HELLO world');
    expect(f.element.value).toContain('again');
    expect(f.element.value).toContain('!');
  });
  it('cancel removes only tentative text and ignores late events', async () => {
    const f = fixture();
    await f.controller.start();
    f.emit(partial(1, 'keep', 'remove'));
    await f.controller.cancel();
    f.emit(partial(2, 'late', 'event'));
    expect(f.element.value).toBe('before keepafter');
    expect(f.controller.getSnapshot().tentative).toBe('');
  });
  it('retains partial text on transport failure; invalidation cannot mutate the replacement draft', async () => {
    const f = fixture();
    await f.controller.start();
    f.emit(partial(1, '', 'retain this'));
    f.emit({ type: 'error', code: 'provider_error', message: 'Unavailable' });
    expect(f.element.value).toContain('retain this');
    expect(f.controller.getSnapshot().status).toBe('error');
    await f.controller.start();
    f.composer.invalidate();
    f.element.value = 'new draft';
    f.emit(partial(9, 'old', ''));
    expect(f.element.value).toBe('new draft');
  });
  it('manual submit awaits the final transcript and submits exactly once', async () => {
    const f = fixture();
    await f.controller.start();
    f.emit(partial(1, '', 'hello'));
    f.deferEnd();
    const submission = f.composer.submit();
    await Promise.resolve();
    expect(f.submit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(f.transport.send).toHaveBeenCalledWith({ type: 'stop' }));
    f.emit({ type: 'final', revision: 3, text: 'final words' });
    f.emit({ type: 'ended', reason: 'stopped' });
    await submission;
    expect(f.submitted).toEqual(['before final wordsafter']);
  });
  it('flushes queued audio before stop and releases on pagehide', async () => {
    const f = fixture();
    await f.controller.start();
    f.captureOptions.onFrame(new Uint8Array([1, 0]), 0.2);
    await f.controller.finish();
    const messages = vi.mocked(f.transport.send).mock.calls.map(([message]) => message.type);
    expect(messages).toEqual(['start', 'audio', 'stop']);
    await f.controller.start();
    window.dispatchEvent(new Event('pagehide'));
    expect(f.controller.getSnapshot().status).toBe('idle');
  });
  it('maps injected capture permission failures into the snapshot and closes transport', async () => {
    const f = fixture();
    f.capture.mockImplementation((options) => ({
      start: async () => {
        options.onError({ code: 'unauthorized', message: 'Microphone denied' });
      },
      stop: f.stop,
    }));
    await f.controller.start();
    expect(f.controller.getSnapshot().error?.code).toBe('unauthorized');
    expect(f.transport.close).toHaveBeenCalled();
  });
});

describe('auto send', () => {
  it('counts words, not frames or repeated hypotheses, then sends once', async () => {
    vi.useFakeTimers();
    const f = fixture({ enabled: true, silenceMs: 1000 });
    await f.controller.start();
    f.emit(partial(1, '', 'hello'));
    await vi.advanceTimersByTimeAsync(500);
    f.emit(partial(2, '', 'hello'));
    f.captureOptions.onFrame(new Uint8Array([0, 0]), 0);
    expect(f.controller.getSnapshot().countdownMs).toBe(500);
    await vi.advanceTimersByTimeAsync(600);
    expect(f.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it.each(['typing', 'keypress', 'explicit'] as const)(
    '%s cancels automatic submission',
    async (kind) => {
      vi.useFakeTimers();
      const f = fixture({ enabled: true, silenceMs: 500 });
      await f.controller.start();
      f.emit(partial(1, 'hello', ''));
      if (kind === 'typing') {
        f.element.value += '!';
        f.element.dispatchEvent(new Event('input'));
      } else if (kind === 'keypress')
        f.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
      else f.controller.cancelAutoSend();
      await vi.advanceTimersByTimeAsync(2000);
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.controller.getSnapshot().countdownMs).toBeNull();
    },
  );
  it('does not send empty or disabled drafts', async () => {
    vi.useFakeTimers();
    const f = fixture({ enabled: true, silenceMs: 500 });
    await f.controller.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.submit).not.toHaveBeenCalled();
    f.setAllowed(false);
    f.emit(partial(1, 'words', ''));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('strips a normalized trailing keyword and sends immediately after final flush', async () => {
    const f = fixture({ enabled: true, silenceMs: 5000, keyword: 'SEND IT' });
    f.setFinal('Hello send it!');
    await f.controller.start();
    f.emit(partial(1, 'Hello send it!', ''));
    await vi.waitFor(() => expect(f.submit).toHaveBeenCalledTimes(1));
    expect(f.submitted).toEqual(['before Helloafter']);
  });
  it('keyword-only speech never sends', async () => {
    const f = fixture({ enabled: true, silenceMs: 1000, keyword: 'send' });
    f.setFinal('send');
    await f.controller.start();
    f.emit(partial(1, 'send', ''));
    await vi.waitFor(() => expect(f.controller.getSnapshot().status).toBe('idle'));
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('typing during finalization cancels a pending auto-send', async () => {
    vi.useFakeTimers();
    const f = fixture({ enabled: true, silenceMs: 500 });
    f.deferEnd();
    await f.controller.start();
    f.emit(partial(1, 'hello', ''));
    await vi.advanceTimersByTimeAsync(600);
    f.controller.notifyUserActivity();
    f.emit({ type: 'final', revision: 2, text: 'hello' });
    f.emit({ type: 'ended', reason: 'stopped' });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('invalidation in the ended-to-submit microtask gap cannot submit a replacement draft', async () => {
    vi.useFakeTimers();
    const f = fixture({ enabled: true, silenceMs: 500 });
    f.deferEnd();
    await f.controller.start();
    f.emit(partial(1, 'hello', ''));
    await vi.advanceTimersByTimeAsync(600);
    f.emit({ type: 'final', revision: 2, text: 'hello' });
    f.emit({ type: 'ended', reason: 'stopped' });
    f.composer.invalidate();
    f.element.value = 'replacement draft';
    await vi.advanceTimersByTimeAsync(1);
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.element.value).toBe('replacement draft');
  });
  it('surfaces a failed automatic submit without retrying or losing the transcript', async () => {
    vi.useFakeTimers();
    const f = fixture({ enabled: true, silenceMs: 500 });
    f.submit.mockRejectedValueOnce(new Error('offline'));
    await f.controller.start();
    f.emit(partial(1, 'hello', ''));
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.controller.getSnapshot().status).toBe('error');
    expect(f.element.value).toContain('hello world');
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('does not treat a tentative keyword as a committed send instruction', async () => {
    const f = fixture({ enabled: true, silenceMs: 5000, keyword: 'send' });
    await f.controller.start();
    f.emit(partial(1, '', 'hello send'));
    expect(f.controller.getSnapshot().status).toBe('listening');
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('limits session duration and finalization wait', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.deferEnd();
    await f.controller.start();
    f.emit(partial(1, 'kept', 'words'));
    await vi.advanceTimersByTimeAsync(300000);
    expect(f.controller.getSnapshot().status).toBe('finalizing');
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.controller.getSnapshot().error?.code).toBe('timeout');
    expect(f.element.value).toContain('kept words');
  });
});
