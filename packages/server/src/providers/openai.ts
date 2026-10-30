import type { AudioFormat, ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from '../index.js';
import { speechError } from '../errors.js';
import {
  authHeaders,
  speechTransport,
  endpoint,
  parseVoices,
  responseJsonValue,
} from '../transport.js';
import { websocketStt } from './session.js';
import { restTranscription } from './openai-rest.js';
import { requestedHttpSynthesis } from '../audio-stream.js';
import type { SpeechTransportOptions } from '../transport.js';
import { registerEndpointAdapters } from '../check-endpoint.js';

const pcm: AudioFormat = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const formats: AudioFormat[] = [
  pcm,
  { kind: 'encoded', mimeType: 'audio/mpeg' },
  { kind: 'encoded', mimeType: 'audio/ogg; codecs=opus' },
];
const voices = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'fable',
  'nova',
  'onyx',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
];
/** OpenAI native GA transcription session, verified against realtime-transcription guide 2026-10-28. */
export function createOpenAIAdapters(config: ProviderEndpointConfig, transportOptions: SpeechTransportOptions = {}): {
  stt: SttAdapter;
  tts: TtsAdapter;
} {
  const { checkedFetch } = speechTransport(transportOptions);
  const base = config.baseUrl ?? 'https://api.openai.com/v1';
  const customEndpoint = new URL(base).hostname !== 'api.openai.com';
  const model = config.model || 'gpt-4o-mini-tts';
  const modelVoices =
    model === 'tts-1' || model === 'tts-1-hd'
      ? voices.filter((id) => !['ballad', 'verse', 'marin', 'cedar'].includes(id))
      : voices;
  const builtInVoices = () => modelVoices.map((id) => ({
    id,
    name: id,
    ...(id === 'alloy' ? { isDefault: true } : {}),
  }));
  const headers = authHeaders(config.apiKey);
  const transport = config.options?.sttTransport ?? 'realtime';
  const timeoutMs = config.options?.sttRequestTimeoutMs ?? 10_000;
  if (
    (transport !== 'rest' && transport !== 'realtime') ||
    typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
  )
    throw speechError('invalid_message');
  const capabilities = { live: true as const, interim: transport !== 'rest', sampleRates: [24000] };
  return registerEndpointAdapters(config, transportOptions, createOpenAIAdapters, {
    stt: {
      id: 'openai',
      capabilities,
      open({ format, language, signal }) {
        if (format.encoding !== 'pcm_s16le' || format.sampleRate !== 24000 || format.channels !== 1)
          throw speechError('unsupported');
        const rest = () => {
          capabilities.interim = false;
          return restTranscription({
            transport: transportOptions,
            url: endpoint(base, 'audio/transcriptions'), headers,
            model: config.model || 'whisper-1', language, rate: format.sampleRate, signal, timeoutMs,
          });
        };
        if (transport === 'rest') return rest();
        const url = endpoint(base, 'realtime');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        url.searchParams.set('intent', 'transcription');
        let revision = 0,
          tentative = '',
          completed = false;
        return websocketStt({
          transport: transportOptions,
          url,
          headers,
          signal,
          start: {
            type: 'session.update',
            session: {
              type: 'transcription',
              audio: {
                input: {
                  format: { type: 'audio/pcm', rate: 24000 },
                  transcription: {
                    model: config.model || 'gpt-live-transcribe',
                    ...(language
                      ? config.model === 'gpt-live-transcribe' || !config.model
                        ? { languages: [language] }
                        : { language }
                      : {}),
                  },
                  turn_detection: null,
                },
              },
            },
          },
          audio: (audio) =>
            JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: Buffer.from(audio).toString('base64'),
            }),
          stop: { type: 'input_audio_buffer.commit' },
          emptyEnd: true,
          fallback: rest,
          parse(event) {
            if (
              event.type === 'error' ||
              event.type === 'conversation.item.input_audio_transcription.failed'
            )
              throw speechError('provider_error');
            if (event.type === 'session.updated') return { ready: true };
            if (event.type === 'conversation.item.input_audio_transcription.delta') {
              if (typeof event.delta !== 'string' || tentative.length + event.delta.length > 32000)
                throw speechError('provider_error');
              tentative += event.delta;
              return { events: [{ type: 'partial', revision: revision++, text: tentative }] };
            }
            if (
              event.type === 'conversation.item.input_audio_transcription.completed' &&
              !completed
            ) {
              if (typeof event.transcript !== 'string' || event.transcript.length > 32000)
                throw speechError('provider_error');
              completed = true;
              return {
                events: [{ type: 'final', mode: 'append', text: event.transcript }],
                done: true,
              };
            }
            return {};
          },
        });
      },
    },
    tts: {
      id: 'openai',
      capabilities: {
        streamingAudio: true,
        streamingText: false,
        formats,
        voices: customEndpoint ? 'list' : 'fixed',
      },
      async listVoices(signal) {
        signal.throwIfAborted();
        if (customEndpoint) {
          const response = await checkedFetch(endpoint(base, 'audio/voices'), {
            headers,
            signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
          });
          const body = await responseJsonValue(response);
          const entries = Array.isArray(body)
            ? body
            : (body as { voices?: unknown } | null)?.voices;
          const discovered = parseVoices(Array.isArray(entries)
            ? entries.map((entry: unknown) => {
                if (typeof entry === 'string') return { id: entry, name: entry };
                const value = entry as Record<string, unknown> | null;
                const id = value?.id ?? value?.name ?? value?.voice;
                return { ...value, id, name: value?.name ?? id };
              })
            : entries);
          const preferred = discovered.find((voice) => voice.id === 'alloy') ?? discovered[0];
          if (preferred) preferred.isDefault = true;
          return discovered;
        }
        return builtInVoices();
      },
      synthesize: requestedHttpSynthesis(async function (request) {
        if (!customEndpoint && request.voice && !modelVoices.includes(request.voice))
          throw speechError('invalid_message');
        if (
          request.speed !== undefined &&
          (!Number.isFinite(request.speed) || request.speed < 0.25 || request.speed > 4)
        )
          throw speechError('invalid_message');
        const format = request.format;
        const response_format =
          format.kind === 'pcm' &&
          format.sampleRate === 24000 &&
          format.channels === 1 &&
          format.encoding === 'pcm_s16le'
            ? 'pcm'
            : format.kind === 'encoded' && format.mimeType === 'audio/mpeg'
              ? 'mp3'
              : format.kind === 'encoded' && format.mimeType === 'audio/ogg; codecs=opus'
                ? 'opus'
                : undefined;
        if (!response_format) throw speechError('unsupported');
        const response = await checkedFetch(endpoint(base, 'audio/speech'), {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          signal: request.signal,
          body: JSON.stringify({
            model,
            input: request.text,
            voice: request.voice ?? 'alloy',
            response_format,
            stream_format: 'audio',
            ...(request.speed === undefined ? {} : { speed: request.speed }),
          }),
        });
        return response;
      }),
    },
  });
}
