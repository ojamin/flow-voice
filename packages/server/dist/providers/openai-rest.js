import { DEFAULT_LIMITS } from '@flow-voice/core';
import { normalizeSpeechError, speechError } from '../errors.js';
import { BoundedQueue, checkedFetch, linkedAbort, responseJson } from '../transport.js';
/** PCM16 mono RIFF, with no encoder or container dependency. */
function wav(pcm, rate) {
    const bytes = new Uint8Array(44 + pcm.length);
    const view = new DataView(bytes.buffer);
    const text = (offset, value) => {
        for (let i = 0; i < value.length; i++)
            bytes[offset + i] = value.charCodeAt(i);
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + pcm.length, true);
    text(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, pcm.length, true);
    bytes.set(pcm, 44);
    return bytes;
}
export function restTranscription(options) {
    const { controller, dispose } = linkedAbort(options.signal);
    const signal = controller.signal;
    const maxSamples = options.rate * 12;
    // One active request plus two chunks of pending PCM; overflow never drops accepted audio.
    const maxBytes = maxSamples * 2 * 3;
    let current = new Uint8Array(maxSamples * 2);
    let size = 0, buffered = 0, quiet = 0, energy = 0, windowSamples = 0;
    let speech = false, ending = false, finished = false, running = false;
    let committed = '', revision = 0;
    const pending = [];
    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const events = new BoundedQueue(64, () => controller.abort());
    const finish = (error) => {
        if (finished)
            return;
        finished = true;
        pending.length = 0;
        current = new Uint8Array(0);
        buffered = size = 0;
        try {
            if (error && !options.signal.aborted && !signal.aborted)
                events.push({ type: 'error', ...normalizeSpeechError(error) });
            events.push({ type: 'ended', reason: signal.aborted ? 'cancelled' : error ? 'error' : 'stopped' });
        }
        catch {
            events.discard();
            events.push({ type: 'error', ...normalizeSpeechError(speechError('limit_exceeded')) });
            events.push({ type: 'ended', reason: 'error' });
        }
        finally {
            events.close();
            signal.removeEventListener('abort', onAbort);
            controller.abort();
            dispose();
            resolveDone();
        }
    };
    const onAbort = () => { if (!running)
        finish(); };
    signal.addEventListener('abort', onAbort, { once: true });
    const pump = async () => {
        if (running || finished)
            return;
        running = true;
        try {
            while (pending.length && !signal.aborted) {
                const pcm = pending.shift();
                const timeout = new AbortController();
                const timer = setTimeout(() => timeout.abort(), options.timeoutMs);
                try {
                    const body = new FormData();
                    body.set('file', new Blob([wav(pcm, options.rate)], { type: 'audio/wav' }), 'audio.wav');
                    body.set('model', options.model);
                    body.set('response_format', 'json');
                    if (options.language)
                        body.set('language', options.language);
                    const response = await checkedFetch(options.url, {
                        method: 'POST', headers: options.headers, body,
                        signal: AbortSignal.any([signal, timeout.signal]),
                    }, options.transport);
                    const result = await responseJson(response, 65_536);
                    if (typeof result.text !== 'string' || result.text.length > 32000)
                        throw speechError('provider_error');
                    if (signal.aborted)
                        break;
                    const text = result.text.trim();
                    if (text) {
                        const segment = committed && !/^[.,!?;:…，。！？；：]/u.test(text) ? ` ${text}` : text;
                        if (committed.length + segment.length > 32000)
                            throw speechError('limit_exceeded');
                        committed += segment;
                        events.push({ type: 'final', mode: 'append', text: segment });
                        // Finals commit immediately; clear any previous tentative hypothesis.
                        events.push({ type: 'partial', revision: revision++, text: '' });
                    }
                }
                catch (error) {
                    throw timeout.signal.aborted && !signal.aborted ? speechError('timeout') : error;
                }
                finally {
                    clearTimeout(timer);
                }
                buffered -= pcm.length;
            }
        }
        catch (error) {
            finish(error);
        }
        finally {
            running = false;
            if (signal.aborted || ending)
                finish();
        }
    };
    const flush = () => {
        if (size)
            pending.push(current.slice(0, size));
        size = quiet = energy = windowSamples = 0;
        speech = false;
        void pump();
    };
    if (signal.aborted)
        finish();
    return {
        write(pcm) {
            if (finished || ending || signal.aborted)
                throw speechError('cancelled');
            if (!pcm.length || pcm.length % 2 || pcm.length > DEFAULT_LIMITS.maxFrameBytes)
                throw speechError('invalid_message');
            if (buffered + pcm.length > maxBytes)
                throw speechError('limit_exceeded');
            buffered += pcm.length;
            const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
            for (let i = 0; i < pcm.length; i += 2) {
                current[size++] = pcm[i];
                current[size++] = pcm[i + 1];
                const sample = view.getInt16(i, true);
                energy += sample * sample;
                windowSamples++;
                if (windowSamples === options.rate / 50) {
                    if (energy / windowSamples >= 500 * 500) {
                        speech = true;
                        quiet = 0;
                    }
                    else if (speech)
                        quiet += windowSamples;
                    energy = windowSamples = 0;
                }
                if (size === current.length || (speech && quiet >= options.rate * 0.6))
                    flush();
            }
        },
        end() {
            if (!finished && !ending) {
                ending = true;
                flush();
            }
            return done;
        },
        events,
    };
}
//# sourceMappingURL=openai-rest.js.map