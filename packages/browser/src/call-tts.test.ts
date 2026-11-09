// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_DICTATION_PREFERENCE, type SttServerMessage } from '@flow-voice/core';
import { createLiveTranscriptionSession, type SttAdapter, type SttEvent } from '@flow-voice/server';
import { createAutoReader, createSpeechSession, createTextareaComposerAdapter,
  type AudioCaptureOptions, type DictationTransport } from './index.js';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Real public runner produces revisioned committed/tentative wire messages. Only the
 * recognition source, capture device and audio sink are synthetic; no recognition/AEC claim. */
function fixture(finalization?: Promise<void>) {
  vi.useFakeTimers();
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
  let producer!: ReadableStreamDefaultController<SttEvent>;
  let lastText = '';
  let revision = 0;
  const adapter: SttAdapter = {
    id: 'test', capabilities: { live: true, interim: true, sampleRates: [16000] },
    open({ signal }) {
      const stream = new ReadableStream<SttEvent>({ start(controller) { producer = controller; } });
      const close = () => producer.close();
      signal.addEventListener('abort', close, { once: true });
      return {
        write() {},
        async end() {
          await finalization;
          if (signal.aborted) return;
          producer.enqueue({ type: 'final', mode: 'replace', text: lastText });
          producer.enqueue({ type: 'ended', reason: 'stopped' });
        },
        events: {
          async *[Symbol.asyncIterator]() {
            const reader = stream.getReader();
            try {
              while (true) {
                const next = await reader.read();
                if (next.done) return;
                yield next.value;
              }
            } finally {
              signal.removeEventListener('abort', close);
              await reader.cancel();
              reader.releaseLock();
            }
          },
        },
      };
    },
  };
  const wire: SttServerMessage[] = [];
  const controls: string[] = [];
  const session = createSpeechSession({
    synthesize: async () => ({ stream: new ReadableStream(), mimeType: 'audio/pcm',
      format: { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } }),
    createTransport() {
      let runner!: ReturnType<typeof createLiveTranscriptionSession>;
      const transport: DictationTransport = {
        async connect(options) {
          runner = createLiveTranscriptionSession({ adapter, signal: options.signal,
            async send(message) { wire.push(message); options.onMessage(message); } });
        },
        async send(message) { controls.push(message.type); await runner.receive(message); },
        close() { void runner.cancel(); },
      };
      return transport;
    },
    workletUrl: '/worklet.js',
    capture(options) {
      captureOptions = options;
      return { start: async () => {}, stop: async () => {} };
    },
  });
  cleanups.push(() => session.dispose());
  let captureOptions!: AudioCaptureOptions;
  const element = document.createElement('textarea');
  const sent: string[] = [];
  const composer = createTextareaComposerAdapter({ element,
    canSubmit: () => Boolean(element.value.trim()),
    submit: async () => { sent.push(element.value); element.value = ''; },
  });
  cleanups.push(() => composer.dispose());
  const binding = session.bindComposer(composer, {
    config: () => ({ stt: { enabled: true, sampleRates: [16000], defaults: {} }, tts: { enabled: true } }),
    preferences: () => ({ ...DEFAULT_DICTATION_PREFERENCE, silenceMs: 1500 }),
  });
  session.claimConversation('chat');
  const reader = createAutoReader({ player: session.player, messages: session.messages, enabled: true });
  cleanups.push(() => reader.dispose());
  return { session, binding, element, sent, controls, wire,
    frame: (rms: number) => captureOptions.onFrame(new Uint8Array([0, 0]), rms),
    partial(text: string, committed: boolean) {
      lastText = text;
      producer.enqueue(committed ? { type: 'final', mode: 'replace', text }
        : { type: 'partial', revision: revision++, text });
    },
    reply() {
      session.messages.publish({ conversation: 'chat', source: 'live', message: {
        id: 'alice-reply', markdown: 'Alice is speaking', own: false, complete: true,
      } });
    },
  };
}

it.each([false, true])('auto-sends public producer speech during TTS after a full acoustic pause (committed: %s)', async (committed) => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  f.frame(0.2);
  f.partial('my interruption', committed);
  await vi.waitFor(() => expect(f.element.value).toBe('my interruption'));
  expect(f.wire).toContainEqual(expect.objectContaining({ type: 'partial',
    committed: committed ? 'my interruption' : '', tentative: committed ? '' : 'my interruption' }));
  // Transcript staleness and sustained sound must not be treated as a pause.
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(600);
    f.frame(0.2);
  }
  expect(f.sent).toEqual([]);
  await vi.advanceTimersByTimeAsync(1499);
  f.frame(0);
  expect(f.sent).toEqual([]);
  expect(f.binding.dictation.getSnapshot().countdownMs).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  f.frame(0);
  await vi.waitFor(() => expect(f.sent).toEqual(['my interruption']));
  expect(f.controls.filter((type) => type === 'stop')).toHaveLength(1);
  expect(f.session.player.getSnapshot().status).toBe('playing');
  await vi.advanceTimersByTimeAsync(5000);
  f.frame(0);
  expect(f.sent).toHaveLength(1);
});

it('does not auto-send Alice playback without a user transcript', async () => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  f.frame(0.2);
  await vi.advanceTimersByTimeAsync(5000);
  f.frame(0);
  expect(f.sent).toEqual([]);
  expect(f.controls).not.toContain('stop');
});

it.each(['mute', 'end'] as const)('%s fences late finalization and capture frames during TTS', async (action) => {
  let finish!: () => void;
  const f = fixture(new Promise<void>((resolve) => { finish = resolve; }));
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  f.partial('unsent interruption', true);
  await vi.waitFor(() => expect(f.element.value).toBe('unsent interruption'));
  f.frame(0.2);
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  await vi.waitFor(() => expect(f.binding.dictation.getSnapshot().status).toBe('finalizing'));
  if (action === 'mute') f.binding.call!.setMuted(true);
  else f.binding.call!.end();
  finish();
  await vi.advanceTimersByTimeAsync(5000);
  f.frame(0);
  expect(f.sent).toEqual([]);
  expect(f.binding.dictation.getSnapshot().status).toBe('idle');
});
