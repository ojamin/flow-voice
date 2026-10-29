import type {
  SpeechMessage,
  SpeechPlayer,
  SpeechPlayerOptions,
  SpeechPlayerSnapshot,
} from '../index.js';
import { DEFAULT_LIMITS, type SynthesisAudio } from '@flow-voice/core';
import { createAudioOutput, check, abortable } from './audio.js';

export function createSpeechPlayer(options: SpeechPlayerOptions): SpeechPlayer {
  const output = createAudioOutput();
  const listeners = new Set<() => void>();
  let snapshot: SpeechPlayerSnapshot = {
    status: 'idle',
    messageId: null,
    sectionOrdinal: null,
    queuedMessages: 0,
    error: null,
  };
  let queue: SpeechMessage[] = [];
  let disposed = false;
  let epoch = 0;
  let running = false;
  let paused = false;
  let active: AbortController | undefined;
  type Prefetch = { key: string; controller: AbortController; promise: Promise<SynthesisAudio> };
  let prefetched: Prefetch | undefined;
  const emit = (patch: Partial<SpeechPlayerSnapshot>) => {
    snapshot = { ...snapshot, ...patch, queuedMessages: queue.length };
    listeners.forEach((listener) => listener());
  };
  const cancelFetch = () => {
    prefetched?.controller.abort();
    prefetched = undefined;
  };
  const key = (message: SpeechMessage) => `${message.id}\0${message.sections[0]!.ordinal}`;
  function fetchSection(message: SpeechMessage): Prefetch {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new DOMException('Speech synthesis timed out', 'TimeoutError')),
      30000,
    );
    const response = Promise.resolve()
      .then(() =>
        options.synthesize({
          text: message.sections[0]!.text,
          voice: message.voice,
          speed: message.speed,
          language: message.language,
          signal: controller.signal,
        }),
      )
      .then((audio) => {
        if (controller.signal.aborted) {
          void audio.stream.cancel().catch(() => {});
          check(controller.signal);
        }
        controller.signal.addEventListener(
          'abort',
          () => {
            void audio.stream.cancel().catch(() => {});
          },
          { once: true },
        );
        return audio;
      });
    const promise = abortable(response, controller.signal).finally(() => clearTimeout(timeout));
    void promise.catch(() => {});
    return { key: key(message), controller, promise };
  }
  function nextSection(): SpeechMessage | undefined {
    const first = queue[0];
    if (first && first.sections.length > 1) return { ...first, sections: first.sections.slice(1) };
    return queue[1];
  }
  async function pump() {
    if (
      running ||
      disposed ||
      paused ||
      options.gate?.isMicrophoneActive() ||
      snapshot.status === 'blocked'
    )
      return;
    running = true;
    const generation = epoch;
    try {
      while (queue.length && generation === epoch && !paused && !disposed) {
        const message = queue[0]!;
        const section = message.sections[0]!;
        active = new AbortController();
        const signal = active.signal;
        emit({
          status: 'loading',
          messageId: message.id,
          sectionOrdinal: section.ordinal,
          error: null,
        });
        const fetched = prefetched?.key === key(message) ? prefetched : fetchSection(message);
        prefetched = undefined;
        const abort = () => fetched.controller.abort();
        signal.addEventListener('abort', abort, { once: true });
        try {
          await abortable(Promise.resolve(options.beforePlay?.()), signal);
          check(signal);
          if (options.gate?.isMicrophoneActive()) {
            player.stop();
            return;
          }
          const audio = await abortable(fetched.promise, signal);
          check(signal);
          const next = nextSection();
          if (next && !prefetched) prefetched = fetchSection(next);
          emit({ status: paused ? 'paused' : 'playing' });
          await output.play(audio, signal);
          check(signal);
          // append() can have extended this message while audio was in flight.
          const current = queue[0]!;
          if (current.sections.length > 1)
            queue[0] = { ...current, sections: current.sections.slice(1) };
          else queue.shift();
        } catch (error) {
          if (signal.aborted || generation !== epoch) return;
          cancelFetch();
          if (error instanceof Error && error.name === 'NotAllowedError') {
            emit({ status: 'blocked' });
            return;
          }
          queue.shift();
          emit({
            status: 'error',
            error:
              error instanceof Error && error.name === 'TimeoutError'
                ? { code: 'timeout', message: 'Speech playback timed out' }
                : { code: 'provider_error', message: 'Speech playback failed' },
          });
          return;
        } finally {
          signal.removeEventListener('abort', abort);
        }
      }
      if (!queue.length && generation === epoch)
        emit({ status: 'idle', messageId: null, sectionOrdinal: null });
    } finally {
      running = false;
      if (generation !== epoch) void pump();
    }
  }
  // Ordinals survive message completion so two independent auto-read subscribers cannot replay it.
  const seen = new Map<string, Set<number>>();
  const suppressed = new Set<string>();
  const live = new Set<string>();
  function suppress(id: string) {
    suppressed.add(id);
    if (suppressed.size > 2048) suppressed.delete(suppressed.values().next().value!);
  }
  function add(message: SpeechMessage) {
    if (disposed || suppressed.has(message.id) || options.gate?.isMicrophoneActive()) return;
    if (message.complete === false) live.add(message.id);
    else live.delete(message.id);
    const ordinals = seen.get(message.id) ?? new Set<number>();
    const fresh = message.sections.filter(
      (section) => !ordinals.has(section.ordinal) && section.text.trim(),
    );
    if (!fresh.length) return;
    const count = queue.reduce((sum, item) => sum + item.sections.length, 0);
    if (count + fresh.length > (options.maxQueuedSections ?? DEFAULT_LIMITS.maxQueuedSections)) {
      emit({ error: { code: 'limit_exceeded', message: 'Speech queue is full' } });
      return;
    }
    fresh.forEach((section) => ordinals.add(section.ordinal));
    seen.set(message.id, ordinals);
    // Bounded identity retention; hosts should use stable, globally unique message ids.
    if (seen.size > 2048) seen.delete(seen.keys().next().value!);
    const existing = queue.findIndex((item) => item.id === message.id);
    if (existing >= 0)
      queue[existing] = { ...queue[existing]!, sections: [...queue[existing]!.sections, ...fresh] };
    else queue.push({ ...message, sections: fresh });
    if (running && !prefetched && (snapshot.status === 'playing' || snapshot.status === 'paused')) {
      const next = nextSection();
      if (next) prefetched = fetchSection(next);
    }
    emit({});
    void pump();
  }
  function interrupt() {
    epoch++;
    active?.abort();
    cancelFetch();
  }
  const player: SpeechPlayer = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    async unlock() {
      if (disposed || options.gate?.isMicrophoneActive()) return;
      try {
        await output.unlock();
        emit({ status: queue.length ? 'loading' : 'idle', error: null });
        void pump();
      } catch {
        emit({ status: 'blocked' });
      }
    },
    enqueue(message) {
      suppressed.delete(message.id);
      if (!queue.some((item) => item.id === message.id)) seen.delete(message.id);
      add(message);
    },
    append: add,
    pause() {
      if (!queue.length || disposed) return;
      paused = true;
      output.pause();
      emit({ status: 'paused' });
    },
    setBackgroundAudio: (enabled) => output.setBackground(enabled),
    async resume() {
      if (disposed || options.gate?.isMicrophoneActive()) return;
      try {
        await output.resume();
        paused = false;
        emit({ status: queue.length ? 'playing' : 'idle' });
        void pump();
      } catch {
        emit({ status: 'blocked' });
      }
    },
    skipSection() {
      if (!queue.length) return;
      interrupt();
      const current = queue[0]!;
      if (current.sections.length > 1)
        queue[0] = { ...current, sections: current.sections.slice(1) };
      else queue.shift();
      emit({ status: paused ? 'paused' : 'loading' });
      void pump();
    },
    skipToEnd() {
      if (!queue.length) return;
      suppress(queue[0]!.id);
      interrupt();
      queue.shift();
      emit({ status: paused ? 'paused' : 'loading' });
      void pump();
    },
    stop() {
      queue.forEach((item) => suppress(item.id));
      live.forEach(suppress);
      live.clear();
      interrupt();
      queue = [];
      paused = false;
      output.reset();
      emit({ status: 'idle', messageId: null, sectionOrdinal: null, error: null });
    },
    dispose() {
      if (disposed) return;
      player.stop();
      disposed = true;
      output.dispose();
      unsubscribeGate?.();
      globalThis.removeEventListener?.('pagehide', pagehide);
      listeners.clear();
    },
  };
  const pagehide = () => player.stop();
  const unsubscribeGate = options.gate?.subscribe(() => {
    if (options.gate?.isMicrophoneActive()) player.stop();
  });
  globalThis.addEventListener?.('pagehide', pagehide);
  return player;
}
