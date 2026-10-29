import type { ProviderEndpointConfig, Voice } from '@flow-voice/core';
import type { TtsAdapter } from '../index.js';
import { requestedSynthesis } from '../audio-stream.js';
import {
  nativeError,
  nativeFetch,
  nativeUrl,
  normalizeNative,
  parseVoices,
  pcmFormats,
  requireVoice,
  responseJson,
  MAX_VOICES,
  MAX_VOICE_PAGES,
} from '../transport.js';

// Pinned to the documented bearer-auth, paginated-voices, generation_config API.
// https://docs.cartesia.ai/api-reference/tts/sse
const version = '2026-08-14';
const rates = [8000, 16000, 22050, 24000, 44100, 48000];

export function createCartesiaAdapters(config: ProviderEndpointConfig): { tts: TtsAdapter } {
  const headers = { Authorization: `Bearer ${config.apiKey ?? ''}`, 'Cartesia-Version': version };
  return {
    tts: {
      id: 'cartesia',
      capabilities: {
        streamingAudio: true,
        streamingText: false,
        formats: pcmFormats(rates),
        voices: 'list',
      },
      synthesize: requestedSynthesis(async function* (request) {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const format = request.format;
          if (
            format.kind !== 'pcm' ||
            format.encoding !== 'pcm_s16le' ||
            format.channels !== 1 ||
            !rates.includes(format.sampleRate)
          )
            throw nativeError('unsupported');
          const voice = requireVoice(config, request.voice);
          if (
            request.speed !== undefined &&
            (!Number.isFinite(request.speed) || request.speed < 0.6 || request.speed > 1.5)
          )
            throw nativeError('invalid_message');
          const response = await nativeFetch(
            nativeUrl(config, 'https://api.cartesia.ai', 'tts/sse'),
            {
              method: 'POST',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
              },
              signal: request.signal,
              body: JSON.stringify({
                model_id: config.model || 'sonic-3',
                transcript: request.text,
                voice: { mode: 'id', id: voice },
                output_format: {
                  container: 'raw',
                  encoding: 'pcm_s16le',
                  sample_rate: format.sampleRate,
                },
                ...(request.language ? { language: request.language } : {}),
                ...(request.speed !== undefined
                  ? { generation_config: { speed: request.speed } }
                  : {}),
              }),
            },
          );
          if (!response.body) throw nativeError();
          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let data: string[] = [];
          const event = () => {
            const value = data.join('\n');
            data = [];
            if (!value) return null;
            return JSON.parse(value) as { type?: string; data?: string; error?: unknown };
          };
          while (true) {
            const result = await reader.read();
            buffer += decoder.decode(result.value, { stream: !result.done });
            // Each JSON event is bounded; audio is yielded at event boundaries, never at EOF.
            let newline: number;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newline).replace(/\r$/, '');
              buffer = buffer.slice(newline + 1);
              if (!line) {
                const message = event();
                if (!message) continue;
                if (message.type === 'error' || message.error) throw nativeError();
                if (message.type === 'done') return;
                if (message.type === 'chunk') {
                  if (
                    typeof message.data !== 'string' ||
                    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                      message.data,
                    )
                  )
                    throw nativeError();
                  const audio = Buffer.from(message.data, 'base64');
                  if (audio.byteLength) yield { audio };
                }
              } else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
              if (data.reduce((sum, part) => sum + part.length, 0) > 1_048_576)
                throw nativeError('limit_exceeded');
            }
            if (buffer.length > 1_048_576) throw nativeError('limit_exceeded');
            if (result.done) throw nativeError('transport_error'); // Missing done is a truncated synthesis.
          }
        } catch (error) {
          throw normalizeNative(error, request.signal);
        } finally {
          if (reader) {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
      }),
      async listVoices(signal): Promise<readonly Voice[]> {
        try {
          const voices: Voice[] = [];
          let cursor: string | undefined;
          for (let pageNumber = 0; pageNumber < MAX_VOICE_PAGES; pageNumber++) {
            const url = nativeUrl(config, 'https://api.cartesia.ai', 'voices');
            url.searchParams.set('limit', '100');
            if (cursor) url.searchParams.set('starting_after', cursor);
            const response = await nativeFetch(url, { headers, signal });
            const body = await responseJson(response);
            const page = parseVoices(body.data);
            if (voices.length + page.length > MAX_VOICES) throw nativeError('limit_exceeded');
            voices.push(...page);
            if (body.has_more === false) return voices;
            if (
              body.has_more !== true ||
              !page.length ||
              voices.slice(0, -page.length).some((v) => v.id === page.at(-1)!.id)
            )
              throw nativeError();
            cursor = page.at(-1)!.id;
          }
          throw nativeError('limit_exceeded');
        } catch (error) {
          throw normalizeNative(error, signal);
        }
      },
    },
  };
}
