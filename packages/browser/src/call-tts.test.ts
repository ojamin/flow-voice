// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_DICTATION_PREFERENCE, type SttServerMessage, type SynthesisAudio } from '@flow-voice/core';
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
function fixture(finalization?: Promise<void>, finite = false, synthesis?: Promise<SynthesisAudio>) {
  vi.useFakeTimers();
  const ends: (() => void)[] = [];
  vi.stubGlobal('AudioContext', class {
    state = 'running';
    resume = vi.fn(async () => {});
    suspend = vi.fn(async () => {});
    close = vi.fn(async () => {});
    createMediaStreamDestination() { return { stream: {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(2) }; }
    createBufferSource() {
      const source = { buffer: null, onended: null as (() => void) | null,
        connect() {}, disconnect() {}, stop() {}, start() { ends.push(() => source.onended?.()); } };
      return source;
    }
    currentTime = 0;
    destination = {};
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
    synthesize: async () => synthesis ?? ({ stream: new ReadableStream({ start(c) {
      if (finite) { c.enqueue(new Uint8Array([0, 0, 0, 0])); c.close(); }
    } }), mimeType: 'audio/pcm',
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
    preferences: () => ({ ...DEFAULT_DICTATION_PREFERENCE, silenceMs: 1500, sendAfterPause: true, sendOnWord: true, keyword: 'send' }),
  });
  session.claimConversation('chat');
  const reader = createAutoReader({ player: session.player, messages: session.messages, enabled: true });
  cleanups.push(() => reader.dispose());
  return { session, binding, element, sent, controls, wire, ends,
    finalText: (text: string) => { lastText = text; },
    frame: (rms: number) => captureOptions.onFrame(new Uint8Array([0, 0]), rms),
    partial(text: string, committed: boolean) {
      lastText = text;
      producer.enqueue(committed ? { type: 'final', mode: 'replace', text }
        : { type: 'partial', revision: revision++, text });
    },
    reply(markdown = 'Alice is speaking', id = 'alice-reply') {
      session.messages.publish({ conversation: 'chat', source: 'live', message: {
        id, markdown, own: false, complete: true,
      } });
    },
  };
}

it.each([false, true])('accepts unheard section speech after loading pause/resume and fences late synthesis (committed: %s)', async (committed) => {
  let resolve!: (audio: SynthesisAudio) => void;
  const synthesis = new Promise<SynthesisAudio>((done) => { resolve = done; });
  const f = fixture(undefined, false, synthesis);
  await f.binding.call!.start();
  f.reply('We can review the deployment plan before lunch');
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('loading'));
  f.session.player.pause();
  expect(f.session.player.getSnapshot().status).toBe('paused');
  await f.session.player.resume();
  const stop = vi.spyOn(f.session.player, 'stop');
  const text = 'review the deployment plan';
  f.partial(text, committed);
  await vi.waitFor(() => expect(f.element.value).toBe(text));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(f.session.player.getSnapshot().status).toBe('idle');
  const cancel = vi.fn();
  resolve({ stream: new ReadableStream({ start(c) {
    c.enqueue(new Uint8Array([0, 0, 0, 0])); c.close();
  }, cancel }), mimeType: 'audio/pcm',
    format: { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } });
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  expect(f.ends).toHaveLength(0);
  f.partial(text, committed);
  await vi.advanceTimersByTimeAsync(10);
  expect(f.element.value).toBe(text);
  f.frame(0.2);
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  await vi.waitFor(() => expect(f.sent).toEqual([text]));
  await vi.advanceTimersByTimeAsync(2000);
  f.frame(0);
  expect(f.sent).toEqual([text]);
  expect(stop).toHaveBeenCalledTimes(1);
  expect(f.ends).toHaveLength(0);
});

it.each([false, true])('auto-sends public producer speech during TTS after a full acoustic pause (committed: %s)', async (committed) => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  const stop = vi.spyOn(f.session.player, 'stop');
  f.frame(0.2);
  f.partial('my interruption', committed);
  await vi.waitFor(() => expect(f.element.value).toBe('my interruption'));
  expect(f.session.player.getSnapshot().status).toBe('idle');
  expect(stop).toHaveBeenCalledTimes(1);
  f.session.player.append({ id: 'alice-reply', sections: [{ ordinal: 1, text: 'late continuation' }] });
  expect(f.session.player.getSnapshot().queuedMessages).toBe(0);
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
  expect(f.session.player.getSnapshot().status).toBe('idle');
  await vi.advanceTimersByTimeAsync(5000);
  f.frame(0);
  expect(f.sent).toHaveLength(1);
  expect(stop).toHaveBeenCalledTimes(1);
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
  expect(f.session.player.getSnapshot().status).toBe('playing');
});

it.each([false, true])('filters full, prefix and mid-reply echo before keyword/pause send (committed: %s)', async (committed) => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply('Alice is speaking, please send');
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  const stop = vi.spyOn(f.session.player, 'stop');
  for (const echo of ['ALICE, is speaking! Please SEND.', 'Alice is', 'speaking please send']) {
    f.partial(echo, committed);
    await vi.waitFor(() => expect(f.wire.at(-1)).toMatchObject({ type: 'partial' }));
    await vi.advanceTimersByTimeAsync(10);
    expect(f.element.value).toBe('');
    expect(f.binding.dictation.getSnapshot()).toMatchObject({ committed: '', tentative: '', status: 'listening' });
  }
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  expect(f.sent).toEqual([]);
  expect(f.controls).not.toContain('stop');
  expect(stop).not.toHaveBeenCalled();
  // A final can be the first/only committed hypothesis and must use the same filter.
  const finish = f.binding.dictation.finish();
  await finish;
  expect(f.wire).toContainEqual(expect.objectContaining({ type: 'final', text: 'speaking please send' }));
  expect(f.element.value).toBe('');
  expect(f.sent).toEqual([]);
  expect(stop).not.toHaveBeenCalled();
});

it.each(['Alice is wrong', 'Alice is speaking but stop now', 'please change the topic', 'ploy'])('preserves nonmatching revised/mixed user speech intact: %s', async (text) => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply('Alice is speaking, please send');
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  f.partial('Alice is', false);
  await vi.advanceTimersByTimeAsync(10);
  expect(f.element.value).toBe('');
  f.partial(text, false);
  await vi.waitFor(() => expect(f.element.value).toBe(text));
  expect(f.session.player.getSnapshot().status).toBe('idle');
  f.frame(0.2);
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  await vi.waitFor(() => expect(f.sent).toEqual([text]));
});

it.each([false, true])('filters phone fragments but not incidental overlap or noncontiguous words (committed: %s)', async (committed) => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply('We can review the deployment plan before lunch');
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  for (const echo of ['review the deployment plan', 'REVIEW, the deployment plan!', 'deployment plan before lunch']) {
    f.partial(echo, committed);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.wire.at(-1)).toMatchObject({ type: 'partial',
      committed: committed ? echo : '', tentative: committed ? '' : echo });
    expect(f.element.value).toBe('');
    expect(f.session.player.getSnapshot().status).toBe('playing');
  }
  for (const text of ['the deployment failed yesterday', 'review deployment lunch', 'review the deployment plan but cancel it']) {
    f.partial(text, committed);
    await vi.waitFor(() => expect(f.element.value).toBe(text));
    expect(f.session.player.getSnapshot().status).toBe('idle');
  }
  f.frame(0.2);
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  await vi.waitFor(() => expect(f.sent).toEqual(['review the deployment plan but cancel it']));
});

it('finishes a finite reply without sending, filters late/previous/cross-section echo, then accepts speech', async () => {
  const f = fixture(undefined, true);
  await f.binding.call!.start();
  f.reply('<tts>Alice is speaking</tts><tts>Please send the report</tts>');
  await vi.waitFor(() => expect(f.ends).toHaveLength(1));
  f.ends[0]!();
  await vi.waitFor(() => expect(f.ends).toHaveLength(2));
  const stop = vi.spyOn(f.session.player, 'stop');
  for (const echo of ['Alice is speaking', 'is speaking please send', 'send the report']) {
    f.partial(echo, false);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.element.value).toBe('');
  }
  f.ends[1]!();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('idle'));
  f.partial('Please send the report', true);
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  expect(f.element.value).toBe('');
  expect(f.sent).toEqual([]);
  expect(stop).not.toHaveBeenCalled();
  expect(f.controls.filter((type) => type === 'start')).toHaveLength(1);
  expect(f.binding.dictation.getSnapshot().status).toBe('listening');
  f.partial('my next question', true);
  await vi.waitFor(() => expect(f.element.value).toBe('my next question'));
  f.frame(0);
  await vi.waitFor(() => expect(f.sent).toEqual(['my next question']));
  expect(f.controls.filter((type) => type === 'start')).toHaveLength(2);
});

it.each(['mute', 'end', 'dispose'] as const)('fences stale apply/send when stop synchronously triggers %s', async (action) => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  const unsubscribe = f.session.player.subscribe(() => {
    if (f.session.player.getSnapshot().status !== 'idle') return;
    if (action === 'mute') f.binding.call!.setMuted(true);
    else if (action === 'end') f.binding.call!.end();
    else f.binding.dispose();
  });
  f.partial('genuine speech send', true);
  await vi.advanceTimersByTimeAsync(2000);
  unsubscribe();
  expect(f.element.value).toBe('');
  expect(f.sent).toEqual([]);
  expect(f.controls.filter((type) => type === 'start')).toHaveLength(1);
});

it('recognition at finite reply completion sends once and restarts capture only once', async () => {
  const f = fixture(undefined, true);
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.ends).toHaveLength(1));
  f.ends[0]!();
  f.partial('my question at completion', false);
  await vi.waitFor(() => expect(f.element.value).toBe('my question at completion'));
  f.frame(0.2);
  await vi.advanceTimersByTimeAsync(1500);
  f.frame(0);
  await vi.waitFor(() => expect(f.sent).toEqual(['my question at completion']));
  await vi.advanceTimersByTimeAsync(2000);
  f.frame(0);
  expect(f.controls.filter((type) => type === 'start')).toHaveLength(2);
  expect(f.sent).toHaveLength(1);
  expect(f.binding.dictation.getSnapshot().status).toBe('listening');
  f.reply('A fresh reply', 'new-reply');
  await vi.waitFor(() => expect(f.session.player.getSnapshot()).toMatchObject({ status: 'playing', messageId: 'new-reply' }));
});

it('interrupts for first recognition delivered as a final during finalization', async () => {
  const f = fixture();
  await f.binding.call!.start();
  f.reply();
  await vi.waitFor(() => expect(f.session.player.getSnapshot().status).toBe('playing'));
  f.finalText('first recognized final');
  await f.binding.dictation.finish();
  expect(f.wire).toContainEqual(expect.objectContaining({ type: 'final', text: 'first recognized final' }));
  expect(f.element.value).toBe('first recognized final');
  expect(f.session.player.getSnapshot().status).toBe('idle');
  expect(f.sent).toEqual([]); // Explicit finish is not automatic send.
});

it.each(['mute', 'end', 'dispose'] as const)('%s fences late finalization and capture frames during TTS', async (action) => {
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
  else if (action === 'end') f.binding.call!.end();
  else f.binding.dispose();
  finish();
  await vi.advanceTimersByTimeAsync(5000);
  f.frame(0);
  expect(f.sent).toEqual([]);
  expect(f.binding.dictation.getSnapshot().status).toBe('idle');
});
