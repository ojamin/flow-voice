// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { SttClientMessage } from '@flow-voice/core';
import { createDictationController, createTextareaComposerAdapter } from '../index.js';
import type { DictationController, DictationTransport } from '../index.js';

const controllers: DictationController[] = [];
afterEach(async () => {
  for (const controller of controllers.splice(0)) await controller.dispose();
  vi.useRealTimers();
});
function setup(overrides: Partial<Parameters<typeof createDictationController>[0]> = {}) {
  const element = document.createElement('textarea');
  element.value = 'keep selected text';
  element.setSelectionRange(5, 13);
  const composer = createTextareaComposerAdapter({
    element,
    canSubmit: () => true,
    submit: vi.fn(async () => {}),
  });
  let handlers!: Parameters<DictationTransport['connect']>[0];
  const send = vi.fn(async (message: SttClientMessage) => {
    if (message.type === 'start')
      handlers.onMessage({ type: 'ready', audio: message.audio, interim: true });
  });
  const transport: DictationTransport = {
    connect: vi.fn(async (value) => {
      handlers = value;
    }),
    send,
    close: vi.fn(),
  };
  const capture = vi.fn(() => ({ start: vi.fn(async () => {}), stop: vi.fn(async () => {}) }));
  const controller = createDictationController({
    composer,
    transport,
    capture,
    audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    ...overrides,
  });
  controllers.push(controller);
  return {
    controller,
    element,
    composer,
    capture,
    transport,
    get handlers() {
      return handlers;
    },
  };
}
it('restores the selected original when cancelling tentative-only speech or a permission prompt', async () => {
  const f = setup();
  await f.controller.start();
  await f.controller.cancel();
  expect(f.element.value).toBe('keep selected text');
  await f.controller.start();
  f.handlers.onMessage({ type: 'partial', revision: 1, committed: '', tentative: 'replacement' });
  expect(f.element.value).toBe('keep replacement text');
  await f.controller.cancel();
  expect(f.element.value).toBe('keep selected text');
  f.composer.dispose();
});
it('stops playback before microphone acquisition, and refuses a gate that still plays', async () => {
  const order: string[] = [];
  const playbackGate = {
    stop: vi.fn(() => {
      order.push('stop');
    }),
    isPlaying: () => false,
  };
  const f = setup({
    playbackGate,
    beforeCapture: () => {
      order.push('before');
    },
  });
  await f.controller.start();
  expect(order).toEqual(['stop', 'before']);
  expect(f.capture).toHaveBeenCalledOnce();
  const blocked = setup({ playbackGate: { stop: vi.fn(), isPlaying: () => true } });
  await blocked.controller.start();
  expect(blocked.capture).not.toHaveBeenCalled();
  expect(blocked.controller.getSnapshot().error?.code).toBe('unsupported');
});
it('cancel during connection resolves start, releases binding and rejects late ready', async () => {
  const transport: DictationTransport = {
    connect: () => new Promise(() => {}),
    send: vi.fn(async () => {}),
    close: vi.fn(),
  };
  const f = setup({ transport });
  const start = f.controller.start();
  await Promise.resolve();
  await f.controller.cancel();
  await start;
  expect(f.capture).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().status).toBe('idle');
});
it('times out finalization even if transport admission never resolves', async () => {
  vi.useFakeTimers();
  const f = setup();
  await f.controller.start();
  vi.mocked(f.transport.send).mockImplementation(() => new Promise(() => {}));
  const finishing = f.controller.finish();
  const assertion = expect(finishing).rejects.toMatchObject({ code: 'timeout' });
  await vi.advanceTimersByTimeAsync(10000);
  await assertion;
  expect(f.transport.close).toHaveBeenCalledOnce();
});
it('finish while connecting waits for ready without starting capture', async () => {
  const f = setup();
  const starting = f.controller.start();
  const finishing = f.controller.finish();
  await starting;
  expect(f.capture).not.toHaveBeenCalled();
  f.handlers.onMessage({ type: 'final', revision: 1, text: '' });
  f.handlers.onMessage({ type: 'ended', reason: 'stopped' });
  await finishing;
  expect(f.element.value).toBe('keep selected text');
});
