import { DEFAULT_LIMITS } from '@flow-voice/core';
import type { SpeechErrorCode } from '@flow-voice/core';
import type { SttEvent, SttSession } from '../index.js';
import { normalizeSpeechError, speechError } from '../errors.js';
import { BoundedQueue, jsonFrame, openSpeechSocket } from '../transport.js';

/** Native framing/readiness for Deepgram and AssemblyAI; transport owns socket lifecycle. */
export function nativeSession(options: {
  url: URL;
  authorization: string;
  signal: AbortSignal;
  endMessage: string;
  keepAliveMs?: number;
  chunkBytes?: number;
  minChunkBytes?: number;
  startMessage?: string;
  waitForTermination?: boolean;
  closeCode?(code: number, reason: string): SpeechErrorCode;
  message(
    value: Record<string, unknown>,
    emit: (event: SttEvent) => void,
    complete: () => void,
  ): void;
}): SttSession {
  let accept!: (verified: boolean) => void;
  let reject!: (error: unknown) => void;
  const readiness = new Promise<boolean>((resolve, fail) => { accept = resolve; reject = fail; });
  void readiness.catch(() => {}); // Existing hosts may consume only events.
  let ending = false,
    finished = false,
    ready = !options.startMessage,
    acknowledged = false;
  let remainder = Buffer.alloc(0);
  let buffered = 0;
  const pending: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const events = new BoundedQueue<SttEvent>(128, () => finish('cancelled'));
  const socket = openSpeechSocket({
    url: options.url,
    headers: { Authorization: options.authorization },
    signal: options.signal,
    onOpen() { if (!options.startMessage) accept(true); },
    acceptClose: (code) => ending && code === 1000 && (acknowledged || !options.waitForTermination),
    closeError: (code, reason) =>
      options.closeCode?.(code, reason) ?? (code === 1008 ? 'unauthorized' : 'transport_error'),
  });
  function finish(reason: 'stopped' | 'cancelled' | 'error', error?: unknown) {
    if (finished) return;
    finished = true;
    reject(normalizeSpeechError(error ?? speechError(reason === 'cancelled' ? 'cancelled' : 'provider_error')));
    clearTimeout(timer);
    clearInterval(heartbeat);
    pending.length = 0;
    remainder = Buffer.alloc(0);
    options.signal.removeEventListener('abort', abort);
    socket.close();
    try {
      if (
        reason === 'cancelled' ||
        (error && normalizeSpeechError(error).code === 'limit_exceeded')
      )
        events.discard();
      if (error) events.push({ type: 'error', ...normalizeSpeechError(error) });
      events.push({ type: 'ended', reason });
      events.close();
    } catch {
      events.close(speechError('limit_exceeded'));
    }
    resolveDone();
  }
  const abort = () => finish('cancelled');
  const send = (data: string | Uint8Array) => socket.send(data);
  function flushEnd() {
    if (remainder.length) {
      const tail = Buffer.alloc(Math.max(remainder.length, options.minChunkBytes ?? 0));
      remainder.copy(tail);
      send(tail);
      remainder = Buffer.alloc(0);
    }
    send(options.endMessage);
  }
  function writeAudio(pcm: Uint8Array) {
    if (!options.chunkBytes) return send(pcm);
    remainder = Buffer.concat([remainder, pcm]);
    while (remainder.length >= options.chunkBytes) {
      send(remainder.subarray(0, options.chunkBytes));
      remainder = remainder.subarray(options.chunkBytes);
    }
  }
  function start() {
    ready = true;
    if (options.startMessage) accept(true);
    for (const pcm of pending) writeAudio(pcm);
    pending.length = 0;
    buffered = 0;
    if (ending) flushEnd();
    else if (options.keepAliveMs)
      heartbeat = setInterval(() => {
        try {
          if (!ending) send(JSON.stringify({ type: 'KeepAlive' }));
        } catch (error) {
          finish('error', error);
        }
      }, options.keepAliveMs);
  }
  if (options.signal.aborted) finish('cancelled');
  else {
    options.signal.addEventListener('abort', abort, { once: true });
    if (ready) start();
    void (async () => {
      try {
        for await (const frame of socket.messages) {
          const value = jsonFrame(frame);
          if (!ready && value.type === options.startMessage) start();
          options.message(
            value,
            (event) => events.push(event),
            () => {
              acknowledged = true;
              finish('stopped');
            },
          );
          if (finished) return;
        }
        if (!finished) finish(options.signal.aborted ? 'cancelled' : 'stopped');
      } catch (error) {
        finish(options.signal.aborted ? 'cancelled' : 'error', error);
      }
    })();
  }
  return {
    ready: readiness,
    write(pcm) {
      if (finished || ending) throw speechError('cancelled');
      if (!pcm.length || pcm.length % 2 || pcm.length > DEFAULT_LIMITS.maxFrameBytes)
        throw speechError('invalid_message');
      if (buffered + remainder.length + pcm.length > DEFAULT_LIMITS.maxBufferedAudioBytes)
        throw speechError('limit_exceeded');
      if (ready) writeAudio(pcm);
      else {
        pending.push(pcm.slice());
        buffered += pcm.length;
      }
    },
    end() {
      if (!ending && !finished) {
        ending = true;
        clearInterval(heartbeat);
        timer = setTimeout(
          () => finish('error', speechError('timeout')),
          DEFAULT_LIMITS.finalizationMs,
        );
        try {
          if (ready) flushEnd();
        } catch (error) {
          finish('error', error);
        }
      }
      return done;
    },
    events,
  };
}
