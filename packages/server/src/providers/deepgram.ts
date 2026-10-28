import { pcmInputSchema } from '@flow-voice/core';
import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';

import { normalizeSpeechError, speechError as providerError } from '../errors.js';
import { apiKey, providerUrl, checkedFetch, responseAudio, linkedAbort } from '../transport.js';
import { nativeSession } from './native-session.js';

/** Deepgram v1: is_final commits a segment; speech_final/UtteranceEnd only delimit utterances.
 * https://developers.deepgram.com/reference/speech-to-text/listen-streaming
 * https://github.com/livekit/agents-js/blob/main/plugins/deepgram/src/stt.ts
 * Aura uses https://developers.deepgram.com/reference/text-to-speech/speak-request
 */
export function createDeepgramAdapters(config: ProviderEndpointConfig): {
  stt: SttAdapter;
  tts: TtsAdapter;
} {
  const stt: SttAdapter = {
    id: 'deepgram',
    capabilities: {
      live: true,
      interim: true,
      sampleRates: [8000, 16000, 22050, 24000, 44100, 48000],
    },
    open({ format, language, signal }) {
      pcmInputSchema.parse(format);
      const url = providerUrl(config, '/v1/listen', true);
      const endpointing = config.options?.endpointing ?? 25;
      const utteranceEnd = config.options?.utterance_end_ms ?? 1000;
      if (
        !(endpointing === false || (Number.isInteger(endpointing) && Number(endpointing) >= 0)) ||
        !Number.isInteger(utteranceEnd) ||
        Number(utteranceEnd) < 1000
      )
        throw providerError('invalid_message');
      for (const [key, value] of Object.entries({
        encoding: 'linear16',
        sample_rate: format.sampleRate,
        channels: 1,
        interim_results: true,
        model: config.model || 'nova-3',
        language: language ?? 'en',
        endpointing,
        utterance_end_ms: utteranceEnd,
      }))
        url.searchParams.set(key, String(value));
      let revision = 0;
      let hasCommitted = false;
      return nativeSession({
        url,
        authorization: `Token ${apiKey(config)}`,
        signal,
        endMessage: JSON.stringify({ type: 'CloseStream' }),
        keepAliveMs: 4000,
        message(value, emit) {
          if (value.type === 'Error') throw providerError('provider_error');
          if (value.type !== 'Results') return;
          const channel = value.channel as
            { alternatives?: { transcript?: unknown }[] } | undefined;
          const text = channel?.alternatives?.[0]?.transcript;
          if (
            typeof text !== 'string' ||
            typeof value.is_final !== 'boolean' ||
            (value.speech_final !== undefined && typeof value.speech_final !== 'boolean')
          )
            throw providerError('provider_error');
          if (value.is_final === true) {
            if (text.trim()) {
              emit({ type: 'final', mode: 'append', text: (hasCommitted ? ' ' : '') + text });
              hasCommitted = true;
            }
          } else emit({ type: 'partial', revision: ++revision, text });
        },
      });
    },
  };
  const pcmRates = [8000, 16000, 24000, 32000, 48000];
  const tts: TtsAdapter = {
    id: 'deepgram',
    capabilities: {
      streamingAudio: true,
      streamingText: false,
      voices: 'fixed',
      formats: [
        ...pcmRates.map((sampleRate) => ({
          kind: 'pcm' as const,
          encoding: 'pcm_s16le' as const,
          sampleRate,
          channels: 1 as const,
        })),
        { kind: 'encoded', mimeType: 'audio/mpeg' },
        { kind: 'encoded', mimeType: 'audio/ogg;codecs=opus' },
      ],
    },
    async *synthesize(request) {
      if (request.signal.aborted) throw providerError('cancelled');
      const url = providerUrl(config, '/v1/speak', false);
      url.searchParams.set(
        'model',
        request.voice ?? (config.model.startsWith('aura-') ? config.model : 'aura-2-thalia-en'),
      );
      if (request.speed !== undefined) {
        if (!Number.isFinite(request.speed) || request.speed <= 0)
          throw providerError('invalid_message');
        url.searchParams.set('speed', String(request.speed));
      }
      if (request.format.kind === 'pcm') {
        if (
          request.format.channels !== 1 ||
          request.format.encoding !== 'pcm_s16le' ||
          !pcmRates.includes(request.format.sampleRate)
        )
          throw providerError('unsupported');
        url.searchParams.set('encoding', 'linear16');
        url.searchParams.set('container', 'none');
        url.searchParams.set('sample_rate', String(request.format.sampleRate));
      } else if (request.format.mimeType === 'audio/mpeg') url.searchParams.set('encoding', 'mp3');
      else if (request.format.mimeType === 'audio/ogg;codecs=opus') {
        url.searchParams.set('encoding', 'opus');
        url.searchParams.set('container', 'ogg');
      } else throw providerError('unsupported');
      const link = linkedAbort(request.signal);
      try {
        const response = await checkedFetch(url, {
          method: 'POST',
          headers: { Authorization: `Token ${apiKey(config)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: request.text }),
          signal: link.controller.signal,
        });
        yield* responseAudio(response);
      } catch (error) {
        throw Object.assign(new Error(), normalizeSpeechError(error));
      } finally {
        link.controller.abort();
        link.dispose();
      }
    },
    async listVoices(signal) {
      if (signal.aborted) throw providerError('cancelled');
      return ['aura-2-thalia-en', 'aura-2-andromeda-en', 'aura-2-apollo-en', 'aura-asteria-en'].map(
        (id) => ({ id, name: id, language: 'en' }),
      );
    },
  };
  return { stt, tts };
}
