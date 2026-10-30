import { MAX_TIMER_MS, pcmInputSchema } from '@flow-voice/core';
import type { ProviderEndpointConfig, Voice } from '@flow-voice/core';
import type { SttAdapter, SttSession, TtsAdapter } from './index.js';
import { normalizeSpeechError, speechError } from './errors.js';
import { authHeaders, checkedFetch, createSpeechWebSocket, endpoint, linkedAbort, responseJson } from './transport.js';
import type { SpeechTransportOptions } from './transport.js';
import { resolveVoice, synthesize } from './synthesis.js';

export interface CheckSpeechEndpointOptions {
  stt?: SttAdapter;
  tts?: TtsAdapter;
  signal: AbortSignal;
  /** Total budget across both checks. Defaults to 15 seconds. */
  timeoutMs?: number;
}
export interface SpeechEndpointCheck {
  stt?: { ok: true; verified: true; live?: boolean };
  tts?: { ok: true; voices: readonly Voice[] };
  models?: string[];
  /** Corrected address, only when the single /v1 retry succeeded. */
  baseUrl?: string;
  /** Voice discovery failed; no TTS synthesis was verified. Safe to forward verbatim. */
  voiceError?: string;
}

type Adapters = { stt?: SttAdapter; tts?: TtsAdapter };
type EndpointFactory = (config: ProviderEndpointConfig, transport?: SpeechTransportOptions) => Adapters;
interface ProbeEndpoint {
  config: ProviderEndpointConfig;
  transport: SpeechTransportOptions;
  factory: EndpointFactory;
}
// Private metadata: probes need the factory to try a corrected address without changing runtime adapters.
const endpoints = new WeakMap<SttAdapter | TtsAdapter, ProbeEndpoint>();
export function registerEndpointAdapters<T extends Adapters>(config: ProviderEndpointConfig,
  transport: SpeechTransportOptions, factory: EndpointFactory, adapters: T): T {
  for (const adapter of [adapters.stt, adapters.tts]) {
    if (adapter) endpoints.set(adapter, { config, transport, factory });
  }
  return adapters;
}

async function checkTranscription(adapter: SttAdapter, signal: AbortSignal): Promise<{ ok: true; verified: true; live?: boolean }> {
  const format = pcmInputSchema.safeParse({
    encoding: 'pcm_s16le', channels: 1, sampleRate: adapter.capabilities.sampleRates[0],
  });
  if (!format.success) throw speechError('unsupported');
  const link = linkedAbort(signal);
  let session: SttSession | undefined;
  let consumed: Promise<void> | undefined;
  try {
    session = adapter.open({ format: format.data, signal: link.controller.signal });
    const active = session;
    consumed = (async () => {
      for await (const event of active.events) {
        if (event.type === 'error') throw normalizeSpeechError(event);
        if (event.type === 'ended') {
          if (event.reason !== 'stopped') throw speechError(event.reason === 'cancelled' ? 'cancelled' : 'provider_error');
          return;
        }
      }
      throw speechError('provider_error');
    })();
    void consumed.catch(() => {}); // A readiness failure can precede event consumption.
    if (session.ready && await Promise.race([session.ready, consumed.then(() => false)])) {
      return { ok: true, verified: true, live: true };
    }
    // REST has no authenticated handshake. Flush 20 ms of valid silent PCM to make a real request.
    session.write(new Uint8Array(Math.ceil(format.data.sampleRate / 50) * 2));
    await session.end();
    await consumed;
    return { ok: true, verified: true };
  } finally {
    link.controller.abort();
    link.dispose();
    try {
      await session?.end();
    } finally {
      await consumed?.catch(() => {});
    }
  }
}

async function probeAdapter(adapter: SttAdapter | TtsAdapter, kind: 'stt' | 'tts', signal: AbortSignal): Promise<SpeechEndpointCheck> {
  const metadata = endpoints.get(adapter);
  if (!metadata) return checkAdapters({ [kind]: adapter } as Adapters, signal);
  const { config, transport, factory } = metadata;
  let missing = false;
  let liveMissing = false;
  const observed: SpeechTransportOptions = {
    fetch: async (url, init) => {
      const response = await (transport.fetch ?? fetch)(url, init);
      missing = response.status === 404;
      return response;
    },
    webSocket: (url, init) => {
      const socket = createSpeechWebSocket(url, init, transport);
      socket.on('unexpected-response', (_request, response) => {
        missing = response.statusCode === 404;
        liveMissing = [404, 405, 426].includes(response.statusCode ?? 0);
      });
      return socket;
    },
  };
  let baseUrl = config.baseUrl?.replace(/\/+$/, '');
  let result: SpeechEndpointCheck;
  try {
    result = await checkAdapters({ [kind]: factory(config, observed)[kind] }, signal);
  } catch (error) {
    if (!missing || !baseUrl || /\/v1$/.test(baseUrl) || signal.aborted) throw error;
    baseUrl += '/v1';
    result = await checkAdapters({ [kind]: factory({ ...config, baseUrl }, observed)[kind] }, signal);
    result.baseUrl = baseUrl;
  }
  // An explicit REST selection is not evidence that live is unavailable.
  if (result.stt && !result.stt.live && liveMissing) result.stt.live = false;
  // Discovery is optional and bounded, including the response body before parsing.
  const modelBase = baseUrl ?? (config.provider === 'openai' ? 'https://api.openai.com/v1' : undefined);
  if (modelBase) {
    try {
      const response = await checkedFetch(endpoint(modelBase, 'models'), {
        headers: authHeaders(config.apiKey), signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
      }, transport);
      const body = await responseJson(response);
      if (Array.isArray(body.data)) {
        result.models = [...new Set(body.data.flatMap((entry: unknown) => {
          const id = (entry as { id?: unknown } | null)?.id;
          return typeof id === 'string' && id.length > 0 && id.length <= 200 ? [id] : [];
        }))].slice(0, 1000);
      }
    } catch { /* A catalog failure must not turn a verified endpoint into a failed Test. */ }
  }
  return result;
}

async function checkAdapters(options: Adapters, signal: AbortSignal): Promise<SpeechEndpointCheck> {
  const result: SpeechEndpointCheck = {};
  if (options.tts) {
    const adapter = options.tts;
    let voices: readonly Voice[];
    try {
      voices = adapter.capabilities.voices !== 'none' && adapter.listVoices
        ? await adapter.listVoices(signal) : [];
    } catch (error) {
      // Hosts receive a safe, actionable catalog error, never an upstream body or URL.
      throw Object.assign(error instanceof Error ? error : new Error(), { voiceDiscovery: true });
    }
    const audio = await synthesize({ adapter, signal, voice: resolveVoice({ voices }), text: 'Test.' });
    const reader = audio.stream.getReader();
    try {
      const first = await reader.read();
      if (first.done || !first.value.length) throw speechError('provider_error');
    } finally {
      try { await reader.cancel(); } catch { /* An errored source is already closed. */ }
      reader.releaseLock();
    }
    result.tts = { ok: true, voices };
  }
  if (options.stt) result.stt = await checkTranscription(options.stt, signal);
  signal.throwIfAborted();
  return result;
}

/** Billable real-provider probe, not adapter construction or catalog-only validation. */
export async function checkSpeechEndpoint(options: CheckSpeechEndpointOptions): Promise<SpeechEndpointCheck> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  if ((!options.stt && !options.tts) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_MS)
    throw speechError('invalid_message');
  const link = linkedAbort(options.signal);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; link.controller.abort(); }, timeoutMs);
  const signal = link.controller.signal;
  try {
    signal.throwIfAborted();
    const result: SpeechEndpointCheck = {};
    if (options.tts) Object.assign(result, await probeAdapter(options.tts, 'tts', signal));
    if (options.stt) Object.assign(result, await probeAdapter(options.stt, 'stt', signal));
    options.signal.throwIfAborted();
    return result;
  } catch (error) {
    const normalized = normalizeSpeechError(options.signal.aborted ? speechError('cancelled') : timedOut ? speechError('timeout') : error);
    if (!options.signal.aborted && !timedOut && error && typeof error === 'object' && 'voiceDiscovery' in error)
      return { voiceError: "Couldn't load voices from this server" };
    throw normalized;
  } finally {
    clearTimeout(timer);
    link.controller.abort();
    link.dispose();
  }
}
