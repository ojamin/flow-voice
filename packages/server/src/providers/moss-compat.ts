import type { AudioFormat, ProviderEndpointConfig, Voice } from '@flow-voice/core';
import type { SttAdapter, SttEvent, TtsAdapter } from '../index.js';
import { speechError } from '../errors.js';
import { authHeaders, checkedFetch, endpoint, responseAudio, responseJson } from '../transport.js';
import { websocketStt } from './session.js';

/** Exact speech gateway wire fields; endpoint prefixes are additionally supported. */
export function createMossCompatAdapters(config: ProviderEndpointConfig): {
  stt: SttAdapter;
  tts: TtsAdapter;
} {
  if (!config.baseUrl) throw speechError('not_configured');
  const base = config.baseUrl,
    headers = authHeaders(config.apiKey);
  const model = config.model || 'moss-tts-local-v1.5-q8_0-vulkan';
  // Capabilities are synchronous; verify this model-family format against every stream.
  const formats = [
    { prefix: 'neutts', sampleRate: 24000, channels: 1 },
    { prefix: 'voxcpm2', sampleRate: 48000, channels: 1 },
  ] as const;
  const { sampleRate, channels } = formats.find(({ prefix }) => model.startsWith(prefix)) ??
    { sampleRate: 48000, channels: 2 as const };
  const pcm: AudioFormat = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate, channels };
  async function discover(
    signal: AbortSignal,
  ): Promise<{ voices: Voice[]; defaultVoice?: string }> {
    const response = await checkedFetch(endpoint(base, 'health'), {
      headers: { ...headers, accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw speechError('provider_error');
    }
    const value = (await responseJson(response, 65536)) as Record<string, unknown> | null;
    const section = Object.values(value ?? {}).find(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object' && 'model' in entry && entry.model === model,
    );
    const catalog = section?.voices ?? section?.speakers;
    if (!section || !Array.isArray(catalog))
      throw speechError('provider_error');
    const voices: Voice[] = [];
    for (const raw of catalog.slice(0, 64)) {
      const item = raw as Record<string, unknown> | null;
      const id = typeof raw === 'string' ? raw.trim() : (item?.id ?? item?.voice ?? item?.name);
      if (
        typeof id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id.trim()) ||
        voices.some((voice) => voice.id === id.trim())
      )
        continue;
      const label =
        typeof raw === 'string' ? id : (item?.label ?? item?.display_name ?? item?.name ?? id);
      voices.push({
        id: id.trim(),
        name: typeof label === 'string' ? label.trim().slice(0, 128) || id.trim() : id.trim(),
      });
    }
    const supplied =
      typeof section.default_voice === 'string'
        ? section.default_voice.trim()
        : undefined;
    const defaultVoice = voices.find((voice) => voice.id === supplied) ?? voices[0];
    if (defaultVoice) defaultVoice.isDefault = true;
    return {
      voices,
      defaultVoice: defaultVoice?.id,
    };
  }
  return {
    stt: {
      id: 'moss-compat',
      capabilities: { live: true, interim: true, sampleRates: [16000] },
      open({ format, signal }) {
        if (format.encoding !== 'pcm_s16le' || format.sampleRate !== 16000 || format.channels !== 1)
          throw speechError('unsupported');
        const url = endpoint(base, 'v1/realtime/transcriptions');
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        let committed = '',
          lastRevision = -1,
          ready = false;
        return websocketStt({
          url,
          headers,
          signal,
          start: { type: 'start', encoding: 'pcm_s16le', sample_rate: 16000, att_context_right: 6 },
          audio: (audio) => audio,
          stop: { type: 'stop' },
          parse(event) {
            if (event.type === 'error') throw speechError('provider_error');
            if (event.type === 'session.ready') {
              if (ready) throw speechError('provider_error');
              ready = true;
              return { ready: true };
            }
            if (event.type !== 'transcript' && event.type !== 'transcript.final')
              throw speechError('provider_error');
            if (
              !ready ||
              typeof event.committed !== 'string' ||
              typeof event.tentative !== 'string' ||
              typeof event.revision !== 'number' ||
              !Number.isSafeInteger(event.revision) ||
              event.revision < 0 ||
              typeof event.is_final !== 'boolean' ||
              event.committed.length + event.tentative.length > 32000
            )
              throw speechError('provider_error');
            if (event.revision < lastRevision) return {};
            lastRevision = event.revision;
            if (!event.committed.startsWith(committed)) throw speechError('provider_error');
            const events: SttEvent[] = [];
            const suffix = event.committed.slice(committed.length);
            if (suffix) events.push({ type: 'final', mode: 'replace', text: event.committed });
            committed = event.committed;
            const done = event.type === 'transcript.final' || event.is_final;
            if (done) {
              if (event.tentative)
                events.push({ type: 'final', mode: 'append', text: event.tentative });
            } else
              events.push({ type: 'partial', revision: event.revision, text: event.tentative });
            return { events, done };
          },
        });
      },
    },
    tts: {
      id: 'moss-compat',
      capabilities: { streamingAudio: true, streamingText: false, formats: [pcm], voices: 'list' },
      async listVoices(signal) {
        return (await discover(signal)).voices;
      },
      async *synthesize(request) {
        if (
          request.format.kind !== 'pcm' ||
          request.format.encoding !== 'pcm_s16le' ||
          request.format.sampleRate !== sampleRate ||
          request.format.channels !== channels
        )
          throw speechError('unsupported');
        if (request.speed !== undefined && request.speed !== 1) throw speechError('unsupported');
        if (!request.text.trim() || request.text.trim().length > 2000)
          throw speechError('limit_exceeded');
        const voice = request.voice ?? (await discover(request.signal)).defaultVoice;
        if (!voice) throw speechError('invalid_message');
        const response = await checkedFetch(endpoint(base, 'v1/audio/speech/stream'), {
          method: 'POST',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(300000)]),
          headers: { ...headers, accept: 'audio/pcm', 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            input: request.text.trim(),
            voice,
            emotion: 'neutral',
            temperature: 1,
          }),
        });
        const [mediaType, ...parameters] = (response.headers.get('content-type') ?? '').split(';');
        const params = new Map(parameters.map((parameter) => {
          const [key, value] = parameter.trim().split('=');
          return [key?.toLowerCase(), value?.trim()];
        }));
        const rates = [response.headers.get('x-audio-sample-rate'), params.get('rate')]
          .filter((value) => value != null);
        const channelCounts = [response.headers.get('x-audio-channels'), params.get('channels')]
          .filter((value) => value != null);
        if (
          response.status !== 200 ||
          mediaType?.trim().toLowerCase() !== 'audio/pcm' ||
          response.headers.get('x-audio-encoding') !== 'pcm_s16le' ||
          !rates.length || rates.some((value) => value !== String(sampleRate)) ||
          !channelCounts.length || channelCounts.some((value) => value !== String(channels))
        ) {
          await response.body?.cancel();
          throw speechError('provider_error');
        }
        let bytes = 0;
        for await (const chunk of responseAudio(response)) {
          bytes += chunk.audio.length;
          yield chunk;
        }
        if (!bytes || bytes % (channels * 2) !== 0) throw speechError('provider_error');
      },
    },
  };
}
