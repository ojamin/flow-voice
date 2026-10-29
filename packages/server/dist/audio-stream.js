import { normalizeSpeechError, speechError } from './errors.js';
import { linkedAbort } from './transport.js';
/** Own the response reader immediately, so abort before the first pull cancels it too. */
export function audioFromResponse(response, format, signal) {
    if (!response.body)
        throw speechError('provider_error');
    const reader = response.body.getReader();
    return audioFromChunks(() => ({
        [Symbol.asyncIterator]() {
            return {
                async next() {
                    const result = await reader.read();
                    return result.done ? { done: true, value: undefined } : { done: false, value: { audio: result.value } };
                },
                async return() {
                    try {
                        await reader.cancel();
                    }
                    catch { /* Preserve original failure. */ }
                    finally {
                        reader.releaseLock();
                    }
                    return { done: true, value: undefined };
                },
            };
        },
    }), format, signal, true);
}
/** Adapt request-selected provider protocols without buffering their audio. */
export function requestedSynthesis(generate) {
    return async function (request) {
        const format = request.format ?? this.capabilities.formats[0];
        if (!format || !this.capabilities.formats.some((candidate) => candidate.kind === 'encoded'
            ? format.kind === 'encoded' && candidate.mimeType === format.mimeType
            : format.kind === 'pcm' && candidate.encoding === format.encoding && candidate.sampleRate === format.sampleRate && candidate.channels === format.channels))
            throw speechError('unsupported');
        return audioFromChunks((signal) => generate({ ...request, format, signal }), format, request.signal);
    };
}
export function audioFromChunks(generate, format, signal, validateFrames = false) {
    if (signal.aborted)
        throw speechError('cancelled');
    const link = linkedAbort(signal);
    const iterator = generate(link.controller.signal)[Symbol.asyncIterator]();
    let closed = false;
    let bytes = 0;
    let output;
    const cleanup = async () => {
        if (closed)
            return;
        closed = true;
        link.controller.signal.removeEventListener('abort', abort);
        link.controller.abort();
        link.dispose();
        try {
            await iterator.return?.();
        }
        catch { /* Preserve terminal result. */ }
    };
    const abort = () => {
        if (!closed)
            output.error(speechError('cancelled'));
        void cleanup();
    };
    const stream = new ReadableStream({
        start(controller) {
            output = controller;
            link.controller.signal.addEventListener('abort', abort, { once: true });
            if (link.controller.signal.aborted)
                abort();
        },
        async pull(controller) {
            try {
                const result = await iterator.next();
                if (closed)
                    return;
                if (result.done) {
                    if (validateFrames && format.kind === 'pcm' && (!bytes || bytes % (format.channels * 2)))
                        throw speechError('provider_error');
                    controller.close();
                    await cleanup();
                }
                else {
                    if (!(result.value.audio instanceof Uint8Array) || !result.value.audio.length)
                        throw speechError('provider_error');
                    bytes += result.value.audio.length;
                    controller.enqueue(result.value.audio);
                }
            }
            catch (error) {
                if (!closed)
                    controller.error(normalizeSpeechError(error));
                await cleanup();
            }
        },
        async cancel() { await cleanup(); },
    }, { highWaterMark: 0 });
    return { stream, format, mimeType: format.kind === 'encoded' ? format.mimeType : 'audio/pcm' };
}
//# sourceMappingURL=audio-stream.js.map