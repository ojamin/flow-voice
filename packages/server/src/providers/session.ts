import type { SttEvent, SttSession } from '../index.js';
import { DEFAULT_LIMITS } from '@flow-voice/core';
import { normalizeSpeechError, speechError } from '../errors.js';
import { jsonFrame, openSpeechSocket } from '../transport.js';

/** Protocol-specific state stays in the adapter; common bounded readiness/finalization lifecycle. */
export function websocketStt(options: {
  url: URL;
  headers: Record<string, string>;
  signal: AbortSignal;
  start: unknown;
  audio(pcm: Uint8Array): string | Uint8Array;
  stop: unknown;
  emptyEnd?: boolean;
  /** Only before protocol readiness, so no audio has reached the rejected endpoint. */
  fallback?: () => SttSession;
  parse(event: Record<string, unknown>): { ready?: boolean; events?: SttEvent[]; done?: boolean };
}): SttSession {
  let accept!: (verified: boolean) => void;
  let reject!: (error: unknown) => void;
  const readiness = new Promise<boolean>((resolve, fail) => { accept = resolve; reject = fail; });
  void readiness.catch(() => {}); // Existing hosts may consume only events.
  const socket = openSpeechSocket(options);
  let ready = false,
    stopping = false,
    closed = false,
    buffered = 0;
  let hasAudio = false;
  const pending: Uint8Array[] = [];
  let fallback: SttSession | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let timeoutError: Error | undefined;
  const timeout = () => {
    timeoutError = speechError('timeout');
    socket.close();
  };
  let timer = setTimeout(timeout, 10_000);
  const stop = () => {
    // OpenAI does not permit committing an empty input buffer.
    if (!hasAudio && options.emptyEnd) socket.close();
    else socket.send(JSON.stringify(options.stop));
  };
  const cleanup = () => {
    reject(normalizeSpeechError(speechError(options.signal.aborted ? 'cancelled' : 'provider_error')));
    closed = true;
    clearTimeout(timer);
    socket.close();
    pending.length = 0;
    buffered = 0;
    options.signal.removeEventListener('abort', cleanup);
    resolveDone();
  };
  if (options.signal.aborted) cleanup();
  else options.signal.addEventListener('abort', cleanup, { once: true });
  if (!closed) socket.send(JSON.stringify(options.start));
  return {
    ready: readiness,
    write(pcm) {
      if (fallback) return fallback.write(pcm);
      if (closed || stopping) throw speechError('invalid_message');
      if (!pcm.length || pcm.length % 2 || pcm.length > DEFAULT_LIMITS.maxFrameBytes)
        throw speechError('invalid_message');
      hasAudio = true;
      if (ready) socket.send(options.audio(pcm));
      else {
        if (buffered + pcm.length > DEFAULT_LIMITS.maxBufferedAudioBytes || pending.length >= 64)
          throw speechError('limit_exceeded');
        pending.push(pcm.slice());
        buffered += pcm.length;
      }
    },
    end() {
      if (fallback) return fallback.end();
      if (!stopping && !closed) {
        stopping = true;
        if (ready) stop();
        clearTimeout(timer);
        timer = setTimeout(timeout, DEFAULT_LIMITS.finalizationMs);
      }
      return done;
    },
    events: {
      [Symbol.asyncIterator]() {
        const source = (async function* (): AsyncGenerator<SttEvent> {
          try {
            for await (const frame of socket.messages) {
              const result = options.parse(jsonFrame(frame));
              if (result.ready && !ready) {
                ready = true;
                accept(true);
                clearTimeout(timer);
                for (const pcm of pending) socket.send(options.audio(pcm));
                pending.length = 0;
                buffered = 0;
                if (stopping) {
                  stop();
                  timer = setTimeout(timeout, DEFAULT_LIMITS.finalizationMs);
                }
              }
              for (const event of result.events ?? []) yield event;
              if (result.done) {
                yield { type: 'ended', reason: 'stopped' };
                return;
              }
              if (ready && stopping && !hasAudio) {
                yield { type: 'ended', reason: 'stopped' };
                return;
              }
            }
            if (timeoutError) throw timeoutError;
            if (options.signal.aborted) yield { type: 'ended', reason: 'cancelled' };
            else if (stopping && !hasAudio && options.emptyEnd)
              yield { type: 'ended', reason: 'stopped' };
            else throw speechError('transport_error');
          } catch (error) {
            if (!ready && !options.signal.aborted && options.fallback &&
                error instanceof Error && 'status' in error &&
                [404, 405, 426].includes(Number(error.status))) {
              clearTimeout(timer);
              socket.close();
              fallback = options.fallback();
              accept(false);
              for (const pcm of pending) fallback.write(pcm);
              pending.length = 0;
              buffered = 0;
              if (stopping) void fallback.end();
              yield* fallback.events;
              return;
            }
            if (options.signal.aborted) yield { type: 'ended', reason: 'cancelled' };
            else {
              reject(normalizeSpeechError(timeoutError ?? error));
              yield { type: 'error', ...normalizeSpeechError(timeoutError ?? error) };
              yield { type: 'ended', reason: 'error' };
            }
          } finally {
            cleanup();
          }
        })();
        return {
          next: () => source.next(),
          async return() {
            cleanup();
            return source.return(undefined);
          },
        };
      },
    },
  };
}
