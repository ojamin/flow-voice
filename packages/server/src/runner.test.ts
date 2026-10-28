import { describe, expect, it } from 'vitest';
import type { SttServerMessage } from '@flow-voice/core';
import { createLiveTranscriptionSession, type SttAdapter, type SttEvent } from './index.js';
import { createFakeAdapters } from './testing.js';
import { BoundedQueue } from './transport.js';
import { deferred } from './test-servers.js';

const start = {
  type: 'start',
  version: 1,
  audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
} as const;
function fixture(options: { flush?: boolean; onWrite?: () => void } = {}) {
  const events = new BoundedQueue<SttEvent>();
  const cleaned = deferred();
  let signal!: AbortSignal;
  const adapter: SttAdapter = {
    id: 'test',
    capabilities: { live: true, interim: true, sampleRates: [16000] },
    open(value) {
      signal = value.signal;
      signal.addEventListener(
        'abort',
        () => {
          events.close();
          cleaned.resolve();
        },
        { once: true },
      );
      return {
        events,
        write() {
          options.onWrite?.();
          events.push({ type: 'partial', revision: 0, text: 'hello' });
        },
        async end() {
          if (options.flush !== false) {
            events.push({ type: 'final', mode: 'append', text: 'hello world' });
            events.push({ type: 'ended', reason: 'stopped' });
            events.close();
          }
        },
      };
    },
  };
  return {
    adapter,
    events,
    cleaned,
    get signal() {
      return signal;
    },
  };
}
describe('bounded live runner', () => {
  it('delivers partial before stop, flushes final and releases only after terminal send', async () => {
    const upstream = fixture(),
      partial = deferred(),
      terminal = deferred(),
      delivered = deferred();
    const output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
        if (message.type === 'partial') partial.resolve();
        if (message.type === 'ended') {
          delivered.resolve();
          await terminal.promise;
        }
      },
    });
    await runner.receive(start);
    await runner.receive({ type: 'audio', audio: new Uint8Array(2) });
    await partial.promise;
    expect(output.at(-1)).toMatchObject({ type: 'partial', tentative: 'hello' });
    await runner.receive({ type: 'stop' });
    await delivered.promise;
    expect(output.slice(-2)).toEqual([
      { type: 'final', revision: 2, text: 'hello world' },
      { type: 'ended', reason: 'stopped' },
    ]);
    let done = false;
    void runner.done.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    terminal.resolve();
    await runner.done;
    expect(upstream.signal.aborted).toBe(true);
  });
  it('accumulates independent final segments, ignores stale partial revisions', async () => {
    const output: SttServerMessage[] = [];
    const upstream = fixture();
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
      },
    });
    await runner.receive(start);
    upstream.events.push({ type: 'final', mode: 'append', text: 'one' });
    upstream.events.push({ type: 'partial', revision: 2, text: 'two' });
    upstream.events.push({ type: 'partial', revision: 1, text: 'stale' });
    upstream.events.push({ type: 'final', mode: 'append', text: ' two' });
    upstream.events.push({ type: 'ended', reason: 'stopped' });
    await runner.done;
    expect(output.find((event) => event.type === 'final')).toMatchObject({ text: 'one two' });
    expect(JSON.stringify(output)).not.toContain('stale');
  });
  it('bounds queued audio while the host is backpressured and never writes dropped frames', async () => {
    const blocked = deferred();
    let writes = 0;
    const upstream = fixture({
      onWrite: () => {
        writes++;
      },
    });
    const output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      limits: { maxBufferedAudioBytes: 2 },
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
        if (message.type === 'ready') await blocked.promise;
      },
    });
    const starting = runner.receive(start);
    await Promise.resolve();
    const first = runner.receive({ type: 'audio', audio: new Uint8Array(2) });
    const excess = runner.receive({ type: 'audio', audio: new Uint8Array(2) });
    blocked.resolve();
    await Promise.all([starting, first, excess, runner.done]);
    expect(writes).toBe(0);
    expect(output).toContainEqual({ type: 'ended', reason: 'limit' });
    expect(output).toContainEqual({
      type: 'error',
      code: 'limit_exceeded',
      message: 'Speech limit exceeded.',
    });
  });
  it.each(['cancel', 'signal'] as const)(
    'cancels via %s and returns iterator cleanup',
    async (kind) => {
      const upstream = fixture(),
        controller = new AbortController(),
        output: SttServerMessage[] = [];
      const runner = createLiveTranscriptionSession({
        adapter: upstream.adapter,
        signal: controller.signal,
        async send(message) {
          output.push(message);
        },
      });
      await runner.receive(start);
      if (kind === 'cancel') await runner.receive({ type: 'cancel' });
      else controller.abort();
      await runner.done;
      await upstream.cleaned.promise;
      expect(output.at(-1)).toEqual({ type: 'ended', reason: 'cancelled' });
      await runner.cancel();
      expect(output.filter((event) => event.type === 'ended')).toHaveLength(1);
    },
  );
  it('times out finalization and cleans up a provider that never ends', async () => {
    const upstream = fixture({ flush: false }),
      output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      limits: { finalizationMs: 15 },
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
      },
    });
    await runner.receive(start);
    await runner.receive({ type: 'stop' });
    await runner.done;
    expect(output.slice(-2)).toEqual([
      { type: 'error', code: 'timeout', message: 'Speech operation timed out.' },
      { type: 'ended', reason: 'error' },
    ]);
    expect(upstream.signal.aborted).toBe(true);
  });
  it('duration limit flushes, ends with limit, and accepts no more audio', async () => {
    const upstream = fixture(),
      output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      limits: { maxSessionMs: 15 },
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
      },
    });
    await runner.receive(start);
    await runner.done;
    expect(output.slice(-2)).toEqual([
      { type: 'final', revision: 1, text: 'hello world' },
      { type: 'ended', reason: 'limit' },
    ]);
    await runner.receive({ type: 'audio', audio: new Uint8Array(2) });
  });
  it.each([
    { type: 'audio', audio: new Uint8Array(2) },
    { ...start, version: 2 },
    { type: 'stop' },
  ])('fails closed on invalid sequencing/schema %j', async (message) => {
    const output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: createFakeAdapters().stt,
      signal: new AbortController().signal,
      async send(event) {
        output.push(event);
      },
    });
    await runner.receive(message as Parameters<typeof runner.receive>[0]);
    await runner.done;
    expect(output.at(-2)).toMatchObject({ type: 'error', code: 'invalid_message' });
  });
  it('caps accumulated transcript before sending a protocol-invalid final', async () => {
    const upstream = fixture(),
      output: SttServerMessage[] = [];
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      signal: new AbortController().signal,
      async send(message) {
        output.push(message);
      },
    });
    await runner.receive(start);
    upstream.events.push({ type: 'final', mode: 'append', text: 'one' });
    upstream.events.push({ type: 'final', mode: 'append', text: 'x'.repeat(32000) });
    await runner.done;
    expect(output.at(-2)).toMatchObject({ type: 'final', text: 'one' });
    expect(output.at(-1)).toEqual({ type: 'ended', reason: 'limit' });
  });
  it('cleans up on send failure and already aborted signal', async () => {
    const upstream = fixture();
    const runner = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      signal: new AbortController().signal,
      async send() {
        throw new Error('disconnected');
      },
    });
    await runner.receive(start);
    await runner.done;
    expect(upstream.signal.aborted).toBe(true);
    const controller = new AbortController();
    controller.abort();
    const aborted = createLiveTranscriptionSession({
      adapter: upstream.adapter,
      signal: controller.signal,
      async send() {},
    });
    await aborted.done;
  });
});
