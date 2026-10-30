import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, SttEvent, TtsAdapter } from '../index.js';
import { normalizeSpeechError } from '../errors.js';
import { requestedHttpSynthesis } from '../audio-stream.js';

import {
  nativeError,
  nativeUrl,
  normalizeNative,
  parseVoices,
  pcmFormats,
  requireVoice,
  statusError,
  responseJson,
  speechTransport,
} from '../transport.js';
import type { SpeechTransportOptions, SpeechWebSocket } from '../transport.js';
import { registerEndpointAdapters } from '../check-endpoint.js';

const sttRates = [8000, 16000, 22050, 24000, 44100, 48000];
const ttsRates = [16000, 22050, 24000, 44100];

/** Scribe realtime uses manual commits so end() has an explicit final acknowledgement.
 * Pad short recordings to 300ms: Scribe rejects commits below its minimum duration.
 * Protocol: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime */
export function createElevenLabsAdapters(config: ProviderEndpointConfig, transportOptions: SpeechTransportOptions = {}): {
  stt: SttAdapter;
  tts: TtsAdapter;
} {
  const { nativeFetch, createSpeechWebSocket } = speechTransport(transportOptions);
  const headers = { 'xi-api-key': config.apiKey ?? '' };
  const stt: SttAdapter = {
    id: 'elevenlabs',
    capabilities: { live: true, interim: true, sampleRates: sttRates },
    open({ format, language, signal }) {
      if (
        format.channels !== 1 ||
        format.encoding !== 'pcm_s16le' ||
        !sttRates.includes(format.sampleRate)
      )
        throw nativeError('unsupported');
      const url = nativeUrl(config, 'https://api.elevenlabs.io/v1', 'speech-to-text/realtime');
      url.protocol =
        url.protocol === 'http:' ? 'ws:' : url.protocol === 'https:' ? 'wss:' : url.protocol;
      url.searchParams.set('model_id', config.model || 'scribe_v2_realtime');
      url.searchParams.set('audio_format', `pcm_${format.sampleRate}`);
      url.searchParams.set('commit_strategy', 'manual');
      if (language) url.searchParams.set('language_code', language);
      let socket: SpeechWebSocket;
      try {
        socket = createSpeechWebSocket(url, {
          headers,
          handshakeTimeout: 10_000,
          maxPayload: 1_048_576,
        });
      } catch {
        throw nativeError('transport_error');
      }
      const events: SttEvent[] = [];
      const pending: Buffer[] = [];
      let pendingBytes = 0;
      let totalBytes = 0;
      let revision = 0;
      let hasCommitted = false;
      let ready = false;
      let accept!: (verified: boolean) => void;
      let reject!: (error: unknown) => void;
      const readiness = new Promise<boolean>((resolve, fail) => { accept = resolve; reject = fail; });
      void readiness.catch(() => {}); // Existing hosts may consume only events.
      let ending = false;
      let closed = false;
      let wake: (() => void) | undefined;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let keepalive: ReturnType<typeof setInterval> | undefined;
      const finish = (
        reason: 'stopped' | 'cancelled' | 'error',
        error?: ReturnType<typeof nativeError>,
      ) => {
        if (closed) return;
        closed = true;
        reject(normalizeSpeechError(error ?? nativeError(reason === 'cancelled' ? 'cancelled' : 'provider_error')));
        clearTimeout(deadline);
        clearInterval(keepalive);
        signal.removeEventListener('abort', abort);
        pending.length = 0;
        pendingBytes = 0;
        // Cancellation/error discards pending hypotheses, never replays them after a terminal event.
        if (reason !== 'stopped') events.length = 0;
        if (error)
          events.push({
            type: 'error',
            code: error.code,
            message: error.message,
            retryable: error.retryable,
          });
        events.push({ type: 'ended', reason });
        socket.terminate();
        wake?.();
      };
      const emit = (event: SttEvent) => {
        if (events.length >= 64) return finish('error', nativeError('limit_exceeded'));
        events.push(event);
        wake?.();
      };
      const abort = () => finish('cancelled');
      const send = (audio: Buffer, commit = false) => {
        socket.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: audio.toString('base64'),
            sample_rate: format.sampleRate,
            commit,
          }),
          (error) => {
            if (error) finish('error', nativeError('transport_error'));
          },
        );
      };
      const flush = () => {
        if (!ready || closed) return;
        for (const audio of pending) send(audio);
        pending.length = 0;
        pendingBytes = 0;
        if (ending) {
          if (!totalBytes) return finish('stopped');
          const minimumBytes = Math.ceil(format.sampleRate * 0.3) * 2;
          if (totalBytes < minimumBytes) send(Buffer.alloc(minimumBytes - totalBytes));
          send(Buffer.alloc(0), true);
        }
      };
      socket.on('message', (data) => {
        if (closed) return;
        try {
          const message = JSON.parse(data.toString());
          if (message.message_type === 'session_started') {
            if (ready) throw nativeError();
            ready = true;
            accept(true);
            clearTimeout(deadline);
            if (!ending) deadline = undefined;
            else deadline = setTimeout(() => finish('error', nativeError('timeout')), 10_000);
            keepalive = setInterval(() => {
              if (!ending && !closed) send(Buffer.alloc(0));
            }, 10_000);
            keepalive.unref();
            flush();
          } else if (message.message_type === 'partial_transcript') {
            if (typeof message.text !== 'string') throw nativeError();
            emit({ type: 'partial', revision: ++revision, text: message.text });
          } else if (
            message.message_type === 'committed_transcript' ||
            message.message_type === 'committed_transcript_with_timestamps'
          ) {
            if (typeof message.text !== 'string') throw nativeError();
            if (message.text) {
              emit({
                type: 'final',
                mode: 'append',
                text: (hasCommitted ? ' ' : '') + message.text,
              });
              hasCommitted = true;
            }
            if (ending) finish('stopped');
          } else if (
            typeof message.message_type !== 'string' ||
            message.message_type.includes('error') ||
            message.error
          ) {
            const type = message.message_type;
            finish(
              'error',
              nativeError(
                type === 'auth_error'
                  ? 'unauthorized'
                  : type === 'rate_limited' ||
                      type === 'quota_exceeded' ||
                      type === 'commit_throttled'
                    ? 'rate_limited'
                    : 'provider_error',
              ),
            );
          }
        } catch {
          finish('error', nativeError());
        }
      });
      socket.on('unexpected-response', (_request, response) => {
        response.resume();
        finish('error', statusError(response.statusCode ?? 500));
      });
      socket.on('error', () => finish('error', nativeError('transport_error')));
      socket.on('close', () => {
        if (!closed) finish('error', nativeError('transport_error'));
        resolveDone();
      });
      deadline = setTimeout(() => finish('error', nativeError('timeout')), 10_000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      return {
        ready: readiness,
        write(pcm) {
          if (ending || closed) throw nativeError('cancelled');
          if (!pcm.byteLength || pcm.byteLength % 2 || pcm.byteLength > 32_000)
            throw nativeError('invalid_message');
          // Includes base64/JSON expansion already queued by ws, not just pre-handshake PCM.
          if (pendingBytes + socket.bufferedAmount + (pcm.byteLength * 4) / 3 > 320_000)
            throw nativeError('limit_exceeded');
          const copy = Buffer.from(pcm);
          totalBytes += copy.length;
          if (ready) send(copy);
          else {
            pending.push(copy);
            pendingBytes += copy.length;
          }
        },
        end() {
          if (!ending && !closed) {
            ending = true;
            clearTimeout(deadline);
            deadline = setTimeout(() => finish('error', nativeError('timeout')), 10_000);
            flush();
          }
          return done;
        },
        events: {
          [Symbol.asyncIterator]() {
            const iterator = (async function* () {
              try {
                while (true) {
                  if (events.length) yield events.shift()!;
                  else if (closed) return;
                  else
                    await new Promise<void>((resolve) => {
                      wake = resolve;
                    });
                }
              } finally {
                abort();
                await done;
              }
            })();
            return {
              next: () => iterator.next(),
              // A generator's finally does not run if return precedes its first next().
              async return() {
                abort();
                await done;
                return iterator.return(undefined);
              },
            };
          },
        },
      };
    },
  };
  const tts: TtsAdapter = {
    id: 'elevenlabs',
    capabilities: {
      streamingAudio: true,
      streamingText: false,
      formats: [...pcmFormats(ttsRates), { kind: 'encoded', mimeType: 'audio/mpeg' }],
      voices: 'list',
    },
    synthesize: requestedHttpSynthesis(async function (request) {
      try {
        const voice = requireVoice(config, request.voice);
        let output: string;
        if (
          request.format.kind === 'pcm' &&
          request.format.channels === 1 &&
          request.format.encoding === 'pcm_s16le' &&
          ttsRates.includes(request.format.sampleRate)
        )
          output = `pcm_${request.format.sampleRate}`;
        else if (request.format.kind === 'encoded' && request.format.mimeType === 'audio/mpeg')
          output = 'mp3_44100_128';
        else throw nativeError('unsupported');
        if (
          request.speed !== undefined &&
          (!Number.isFinite(request.speed) || request.speed < 0.7 || request.speed > 1.2)
        )
          throw nativeError('invalid_message');
        const url = nativeUrl(
          config,
          'https://api.elevenlabs.io/v1',
          `text-to-speech/${encodeURIComponent(voice)}/stream`,
        );
        url.searchParams.set('output_format', output);
        const response = await nativeFetch(url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          signal: request.signal,
          body: JSON.stringify({
            text: request.text,
            model_id: config.model || 'eleven_flash_v2_5',
            ...(request.language ? { language_code: request.language } : {}),
            ...(request.speed !== undefined ? { voice_settings: { speed: request.speed } } : {}),
          }),
        });
        return response;
      } catch (error) {
        throw normalizeNative(error, request.signal);
      }
    }),
    async listVoices(signal) {
      try {
        const response = await nativeFetch(
          nativeUrl(config, 'https://api.elevenlabs.io/v1', 'voices'),
          { headers, signal },
        );
        const body = await responseJson(response);
        return parseVoices(body.voices);
      } catch (error) {
        throw normalizeNative(error, signal);
      }
    },
  };
  return registerEndpointAdapters(config, transportOptions, createElevenLabsAdapters, { stt, tts });
}
