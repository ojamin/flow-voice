import { DEFAULT_LIMITS, MAX_TIMER_MS, matchSendKeyword } from '@flow-voice/core';
import type { SpeechError, SttServerMessage } from '@flow-voice/core';
import type {
  AudioCapture,
  DictationController,
  DictationControllerOptions,
  DictationSnapshot,
} from '../index.js';
import { createAudioCapture } from '../capture/capture.js';

type Session = {
  abort: AbortController;
  capture?: AudioCapture;
  revision: number;
  valid: boolean;
  resolveReady(): void;
  ready: Promise<void>;
  resolveDone(): void;
  done: Promise<void>;
  timers: ReturnType<typeof setTimeout>[];
  unbind(): void;
  unsubscribe(): void;
  lastWordAt: number;
  lastSoundAt: number;
  autoCancelled: boolean;
  sending: boolean;
  stopped: boolean;
  keyword?: boolean;
  finishing?: Promise<void>;
  failure?: SpeechError;
};
const initial: DictationSnapshot = {
  status: 'idle',
  committed: '',
  tentative: '',
  rms: 0,
  countdownMs: null,
  error: null,
};

export function createDictationController(
  options: DictationControllerOptions,
): DictationController {
  let snapshot = initial;
  let session: Session | undefined;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<DictationSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const current = (s: Session) => session === s && s.valid;
  const cleanup = (s: Session, retainSubmission = false) => {
    s.valid = false;
    s.abort.abort();
    s.timers.forEach(clearTimeout);
    if (!retainSubmission) {
      s.unbind();
      s.unsubscribe();
    }
    void s.capture?.stop().catch(() => {});
    options.transport.close();
    s.resolveReady();
    s.resolveDone();
  };
  const fail = (s: Session, error: SpeechError) => {
    if (!current(s)) return;
    s.failure = error;
    // On failure the visible hypothesis becomes durable instead of disappearing.
    options.composer.finish([snapshot.committed, snapshot.tentative].filter(Boolean).join(' '));
    cleanup(s);
    publish({ status: 'error', error, rms: 0, countdownMs: null });
  };
  const transportFailure = (s: Session) =>
    fail(s, {
      code: 'transport_error',
      message: 'The speech connection could not deliver audio. Your transcript has been kept.',
    });
  const cancelAutoSend = () => {
    if (session) session.autoCancelled = true;
    if (snapshot.countdownMs !== null) publish({ countdownMs: null });
  };
  const apply = (s: Session, committed: string, tentative: string) => {
    if (!current(s)) return;
    if (committed !== snapshot.committed || tentative !== snapshot.tentative)
      s.lastWordAt = Date.now();
    publish({ committed, tentative });
    options.composer.update({ committed, tentative });
  };
  const finishSession = (s: Session): Promise<void> => {
    if (s.finishing) return s.finishing;
    s.finishing = (async () => {
      if (s.failure) throw s.failure;
      if (!current(s)) return;
      publish({ status: 'finalizing', countdownMs: null });
      s.timers.push(
        setTimeout(
          () =>
            fail(s, {
              code: 'timeout',
              message: 'Final transcription timed out. Your transcript has been kept.',
            }),
          options.finalizationMs ?? DEFAULT_LIMITS.finalizationMs,
        ),
      );
      await s.ready;
      if (!current(s)) {
        if (s.failure) throw s.failure;
        return;
      }
      // stop flushes the final PCM frame before the stop control is sent.
      try {
        await Promise.race([s.capture?.stop(), s.done]);
      } catch {
        transportFailure(s);
      }
      if (!current(s)) {
        if (s.failure) throw s.failure;
        return;
      }
      s.stopped = true;
      try {
        await Promise.race([options.transport.send({ type: 'stop' }), s.done]);
      } catch {
        transportFailure(s);
      }
      await s.done;
      if (s.failure) throw s.failure;
    })();
    return s.finishing;
  };
  const autoSubmit = async (s: Session, keyword: boolean) => {
    if (s.sending || s.autoCancelled || !current(s)) return;
    s.sending = true;
    s.keyword = keyword;
    try {
      await finishSession(s);
      if (s.failure || disposed || session !== s || s.autoCancelled) return;
      let text = [snapshot.committed, snapshot.tentative].filter(Boolean).join(' ');
      if (keyword && options.autoSend?.keyword)
        text = matchSendKeyword(text, options.autoSend.keyword).text;
      if (!text.trim()) return;
      if (!options.composer.canSubmit()) return;
      s.unbind();
      await options.composer.submit();
    } catch {
      if (!s.failure && session === s && !disposed) {
        publish({
          status: 'error',
          error: {
            code: 'transport_error',
            message: 'Your message could not be sent. Your draft has been kept. Try Send again.',
          },
        });
      }
    } finally {
      s.unbind();
      s.unsubscribe();
    }
  };
  const onMessage = (s: Session, message: SttServerMessage) => {
    if (!current(s)) return;
    switch (message.type) {
      case 'ready':
        if (message.audio.sampleRate !== options.audio.sampleRate || message.audio.channels !== 1) {
          fail(s, {
            code: 'unsupported',
            message: 'The speech server requested an incompatible audio format.',
          });
        } else s.resolveReady();
        break;
      case 'partial':
        if (message.revision <= s.revision) return;
        s.revision = message.revision;
        apply(s, message.committed, message.tentative);
        if (
          options.autoSend?.enabled &&
          options.autoSend.keyword &&
          matchSendKeyword(message.committed, options.autoSend.keyword).matched
        )
          void autoSubmit(s, true);
        break;
      case 'final':
        if (message.revision < s.revision) return;
        s.revision = message.revision;
        apply(s, message.text, '');
        if (
          options.autoSend?.enabled &&
          options.autoSend.keyword &&
          matchSendKeyword(message.text, options.autoSend.keyword).matched
        )
          void autoSubmit(s, true);
        break;
      case 'error':
        fail(s, message);
        break;
      case 'ended': {
        if (message.reason === 'error') {
          fail(s, {
            code: 'provider_error',
            message: 'Transcription stopped unexpectedly. Your transcript has been kept.',
          });
          return;
        }
        if (message.reason === 'cancelled') options.composer.cancel();
        else {
          let text = [snapshot.committed, snapshot.tentative].filter(Boolean).join(' ');
          if (s.keyword && !s.autoCancelled && options.autoSend?.keyword) {
            text = matchSendKeyword(text, options.autoSend.keyword).text;
            publish({ committed: text, tentative: '' });
          }
          options.composer.finish(text);
        }
        cleanup(s, s.sending && !s.autoCancelled);
        publish({ status: 'idle', rms: 0, countdownMs: null });
        break;
      }
    }
  };
  const controller: DictationController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    cancelAutoSend,
    notifyUserActivity: cancelAutoSend,
    async start() {
      if (disposed) throw new Error('Dictation controller is disposed');
      if (session?.valid) return;
      let resolveReady!: () => void;
      let resolveDone!: () => void;
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const s: Session = {
        abort: new AbortController(),
        revision: -1,
        valid: true,
        resolveReady,
        ready,
        resolveDone,
        done,
        timers: [],
        unbind: () => {},
        unsubscribe: () => {},
        lastWordAt: Date.now(),
        lastSoundAt: 0,
        autoCancelled: false,
        sending: false,
        stopped: false,
      };
      session = s;
      publish({ ...initial, status: 'connecting' });
      try {
        options.composer.begin();
        s.unbind = options.composer.bindSubmission({
          finish: () => {
            cancelAutoSend();
            return finishSession(s);
          },
          release: () => {
            if (current(s)) {
              cleanup(s);
              publish({ status: 'idle', rms: 0, countdownMs: null });
            }
          },
          invalidate: () => {
            s.autoCancelled = true;
            if (current(s)) {
              s.valid = false;
              void options.transport.send({ type: 'cancel' }).catch(() => {});
              cleanup(s);
              publish({ ...initial });
            }
          },
        });
        const unsubscribeActivity =
          options.composer.subscribeUserActivity?.(cancelAutoSend) ?? (() => {});
        const pagehide = () => {
          void controller.cancel();
        };
        globalThis.window?.addEventListener('pagehide', pagehide);
        s.unsubscribe = () => {
          unsubscribeActivity();
          globalThis.window?.removeEventListener('pagehide', pagehide);
        };
        await options.playbackGate?.stop();
        options.beforeCapture?.();
        if (options.playbackGate?.isPlaying())
          throw {
            code: 'unsupported',
            message: 'Stop speech playback before starting the microphone.',
          };
        if (!current(s)) return;
        const connectionTimer = setTimeout(
          () => fail(s, { code: 'timeout', message: 'The speech server did not become ready.' }),
          options.connectionTimeoutMs ?? 10000,
        );
        s.timers.push(connectionTimer);
        await Promise.race([
          options.transport.connect({
            signal: s.abort.signal,
            onMessage: (message) => onMessage(s, message),
            onError: (error) => fail(s, error),
          }),
          s.done,
        ]);
        if (!current(s)) return;
        await Promise.race([
          options.transport.send({
            type: 'start',
            version: 1,
            audio: options.audio,
            ...(options.language ? { language: options.language } : {}),
          }),
          s.done,
        ]);
        await ready;
        if (!current(s)) return;
        clearTimeout(connectionTimer);
        if (snapshot.status === 'finalizing') return;
        s.capture = (options.capture ?? createAudioCapture)({
          format: options.audio,
          signal: s.abort.signal,
          ...(options.workletUrl ? { workletUrl: options.workletUrl } : {}),
          onError: (error) => fail(s, error),
          onFrame: (audio, rms) => {
            if (!current(s) || s.stopped) return;
            if (rms > 0.025) s.lastSoundAt = Date.now();
            publish({ rms });
            // Bound the host queue even when a custom transport has slow admission.
            queuedBytes += audio.byteLength;
            if (queuedBytes > DEFAULT_LIMITS.maxBufferedAudioBytes) {
              fail(s, {
                code: 'limit_exceeded',
                message: 'The speech connection is too slow. Your transcript has been kept.',
              });
              return;
            }
            sending = sending
              .then(async () => {
                if (current(s)) await options.transport.send({ type: 'audio', audio });
              })
              .catch(() => transportFailure(s))
              .finally(() => {
                queuedBytes -= audio.byteLength;
              });
          },
        });
        let queuedBytes = 0;
        let sending = Promise.resolve();
        // Capture stop waits for queued frames before the controller sends stop.
        const capture = s.capture;
        s.capture = {
          start: () => capture.start(),
          stop: async () => {
            await capture.stop();
            await sending;
          },
        };
        await Promise.race([s.capture.start(), s.done]);
        if (!current(s) || snapshot.status !== 'connecting') return;
        publish({ status: 'listening' });
        const sessionMs = options.maxSessionMs ?? DEFAULT_LIMITS.maxSessionMs;
        if (sessionMs <= MAX_TIMER_MS)
          s.timers.push(
            setTimeout(() => {
              void finishSession(s).catch(() => {});
            }, sessionMs),
          );
        const tick = () => {
          if (!current(s) || snapshot.status !== 'listening') return;
          if (
            options.autoSend?.enabled &&
            options.autoSend.afterPause !== false &&
            !s.autoCancelled &&
            !s.sending &&
            [snapshot.committed, snapshot.tentative].join('').trim()
          ) {
            const remaining = Math.max(0, options.autoSend.silenceMs - (Date.now() - s.lastWordAt));
            publish({ countdownMs: options.composer.canSubmit() ? remaining : null });
            // RMS only defers briefly; steady noise cannot restart the word-based clock.
            if (
              remaining === 0 &&
              (Date.now() - s.lastSoundAt > 250 ||
                Date.now() - s.lastWordAt > options.autoSend.silenceMs + 500) &&
              options.composer.canSubmit()
            )
              void autoSubmit(s, false);
          }
          s.timers.push(setTimeout(tick, 100));
          // Keep timer bookkeeping bounded for long sessions.
          if (s.timers.length > 16) s.timers.splice(2, s.timers.length - 4);
        };
        tick();
      } catch (cause) {
        if (current(s))
          fail(
            s,
            typeof cause === 'object' &&
              cause !== null &&
              'code' in cause &&
              typeof cause.code === 'string' &&
              'message' in cause &&
              typeof cause.message === 'string'
              ? (cause as SpeechError)
              : {
                  code: 'transport_error',
                  message: 'Dictation could not start. Check your connection and microphone.',
                },
          );
      }
    },
    async finish() {
      cancelAutoSend();
      if (session) await finishSession(session);
    },
    async cancel() {
      const s = session;
      cancelAutoSend();
      if (!s) return;
      if (!current(s)) {
        s.unbind();
        s.unsubscribe();
        return;
      }
      // Invalidate before awaiting anything: late events cannot change the draft.
      s.valid = false;
      void options.transport.send({ type: 'cancel' }).catch(() => {});
      options.composer.cancel();
      cleanup(s);
      publish({ status: 'idle', tentative: '', rms: 0, countdownMs: null });
      await s.capture?.stop();
    },
    async dispose() {
      disposed = true;
      await controller.cancel();
      listeners.clear();
    },
  };
  return controller;
}
