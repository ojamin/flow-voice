import { MAX_TIMER_MS, pcmInputSchema } from '@flow-voice/core';
import { normalizeSpeechError, speechError } from './errors.js';
import { linkedAbort } from './transport.js';
import { resolveVoice, synthesize } from './synthesis.js';
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
            return { ok: true, verified: true };
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
        if (options.tts) {
            const adapter = options.tts;
            const voices = adapter.capabilities.voices !== 'none' && adapter.listVoices
                ? await adapter.listVoices(signal) : [];
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
    catch (error) {
        throw normalizeSpeechError(options.signal.aborted ? speechError('cancelled') : timedOut ? speechError('timeout') : error);
    }
    finally {
        clearTimeout(timer);
        link.controller.abort();
        link.dispose();
    }
}
//# sourceMappingURL=check-endpoint.js.map