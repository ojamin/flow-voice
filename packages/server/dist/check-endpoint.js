import { MAX_TIMER_MS, pcmInputSchema } from '@flow-voice/core';
import { normalizeSpeechError, speechError } from './errors.js';
import { authHeaders, checkedFetch, createSpeechWebSocket, endpoint, linkedAbort, responseJson } from './transport.js';
import { resolveVoice, synthesize } from './synthesis.js';
// Private metadata: probes need the factory to try a corrected address without changing runtime adapters.
const endpoints = new WeakMap();
export function registerEndpointAdapters(config, transport, factory, adapters) {
    for (const adapter of [adapters.stt, adapters.tts]) {
        if (adapter)
            endpoints.set(adapter, { config, transport, factory });
    }
    return adapters;
}
async function checkTranscription(adapter, signal) {
    const format = pcmInputSchema.safeParse({
        encoding: 'pcm_s16le', channels: 1, sampleRate: adapter.capabilities.sampleRates[0],
    });
    if (!format.success)
        throw speechError('unsupported');
    const link = linkedAbort(signal);
    let session;
    let consumed;
    try {
        session = adapter.open({ format: format.data, signal: link.controller.signal });
        const active = session;
        consumed = (async () => {
            for await (const event of active.events) {
                if (event.type === 'error')
                    throw normalizeSpeechError(event);
                if (event.type === 'ended') {
                    if (event.reason !== 'stopped')
                        throw speechError(event.reason === 'cancelled' ? 'cancelled' : 'provider_error');
                    return;
                }
            }
            throw speechError('provider_error');
        })();
        void consumed.catch(() => { }); // A readiness failure can precede event consumption.
        if (session.ready && await Promise.race([session.ready, consumed.then(() => false)])) {
            return { ok: true, verified: true, live: true };
        }
        // REST has no authenticated handshake. Flush 20 ms of valid silent PCM to make a real request.
        session.write(new Uint8Array(Math.ceil(format.data.sampleRate / 50) * 2));
        await session.end();
        await consumed;
        return { ok: true, verified: true };
    }
    finally {
        link.controller.abort();
        link.dispose();
        try {
            await session?.end();
        }
        finally {
            await consumed?.catch(() => { });
        }
    }
}
async function probeAdapter(adapter, kind, signal) {
    const metadata = endpoints.get(adapter);
    if (!metadata)
        return checkAdapters({ [kind]: adapter }, signal);
    const { config, transport, factory } = metadata;
    let missing = false;
    let liveMissing = false;
    const observed = {
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
    let result;
    try {
        result = await checkAdapters({ [kind]: factory(config, observed)[kind] }, signal);
    }
    catch (error) {
        if (!missing || !baseUrl || /\/v1$/.test(baseUrl) || signal.aborted)
            throw error;
        baseUrl += '/v1';
        result = await checkAdapters({ [kind]: factory({ ...config, baseUrl }, observed)[kind] }, signal);
        result.baseUrl = baseUrl;
    }
    // An explicit REST selection is not evidence that live is unavailable.
    if (result.stt && !result.stt.live && liveMissing)
        result.stt.live = false;
    // Discovery is optional and bounded, including the response body before parsing.
    const modelBase = baseUrl ?? (config.provider === 'openai' ? 'https://api.openai.com/v1' : undefined);
    // Some servers serve speech at the root but list models only under /v1.
    const modelBases = !modelBase ? [] : /\/v1$/.test(modelBase) ? [modelBase] : [modelBase, `${modelBase}/v1`];
    for (const base of modelBases) {
        let status;
        const recording = {
            fetch: async (url, init) => {
                const response = await (transport.fetch ?? fetch)(url, init);
                status = response.status;
                return response;
            },
        };
        try {
            const response = await checkedFetch(endpoint(base, 'models'), {
                headers: authHeaders(config.apiKey), signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
            }, recording);
            const body = await responseJson(response);
            if (Array.isArray(body.data)) {
                result.models = [...new Set(body.data.flatMap((entry) => {
                        const id = entry?.id;
                        return typeof id === 'string' && id.length > 0 && id.length <= 200 ? [id] : [];
                    }))].slice(0, 1000);
            }
            break;
        }
        catch {
            // A catalog failure must not turn a verified endpoint into a failed Test; only a 404 tries /v1.
            if (status !== 404)
                break;
        }
    }
    return result;
}
async function checkAdapters(options, signal) {
    const result = {};
    if (options.tts) {
        const adapter = options.tts;
        let voices;
        try {
            voices = adapter.capabilities.voices !== 'none' && adapter.listVoices
                ? await adapter.listVoices(signal) : [];
        }
        catch (error) {
            // Hosts receive a safe, actionable catalog error, never an upstream body or URL.
            throw Object.assign(error instanceof Error ? error : new Error(), { voiceDiscovery: true });
        }
        const audio = await synthesize({ adapter, signal, voice: resolveVoice({ voices }), text: 'Test.' });
        const reader = audio.stream.getReader();
        try {
            const first = await reader.read();
            if (first.done || !first.value.length)
                throw speechError('provider_error');
        }
        finally {
            try {
                await reader.cancel();
            }
            catch { /* An errored source is already closed. */ }
            reader.releaseLock();
        }
        result.tts = { ok: true, voices };
    }
    if (options.stt)
        result.stt = await checkTranscription(options.stt, signal);
    signal.throwIfAborted();
    return result;
}
/** Billable real-provider probe, not adapter construction or catalog-only validation. */
export async function checkSpeechEndpoint(options) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    if ((!options.stt && !options.tts) || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_MS)
        throw speechError('invalid_message');
    const link = linkedAbort(options.signal);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; link.controller.abort(); }, timeoutMs);
    const signal = link.controller.signal;
    try {
        signal.throwIfAborted();
        const result = {};
        if (options.tts)
            Object.assign(result, await probeAdapter(options.tts, 'tts', signal));
        if (options.stt)
            Object.assign(result, await probeAdapter(options.stt, 'stt', signal));
        options.signal.throwIfAborted();
        return result;
    }
    catch (error) {
        const normalized = normalizeSpeechError(options.signal.aborted ? speechError('cancelled') : timedOut ? speechError('timeout') : error);
        if (!options.signal.aborted && !timedOut && error && typeof error === 'object' && 'voiceDiscovery' in error)
            return { voiceError: "Couldn't load voices from this server" };
        throw normalized;
    }
    finally {
        clearTimeout(timer);
        link.controller.abort();
        link.dispose();
    }
}
//# sourceMappingURL=check-endpoint.js.map