import { DEFAULT_LIMITS } from '@flow-voice/core';
import { normalizeSpeechError, speechError } from './errors.js';
import { linkedAbort } from './transport.js';
function sameFormat(a, b) {
    return a.kind === 'encoded'
        ? b.kind === 'encoded' && a.mimeType === b.mimeType
        : b.kind === 'pcm' &&
            a.encoding === b.encoding &&
            a.sampleRate === b.sampleRate &&
            a.channels === b.channels;
}
export async function synthesize(options) {
    const max = options.maxTextChars ?? DEFAULT_LIMITS.maxTextChars;
    if (!Number.isSafeInteger(max) || max <= 0 || max > DEFAULT_LIMITS.maxTextChars)
        throw speechError('invalid_message');
    if (typeof options.text !== 'string' || !options.text.trim())
        throw speechError('invalid_message');
    if (options.text.length > max)
        throw speechError('limit_exceeded');
    if (options.voice !== undefined &&
        (typeof options.voice !== 'string' || !options.voice.trim() || options.voice.length > 128))
        throw speechError('invalid_message');
    if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0))
        throw speechError('invalid_message');
    if (!options.adapter.capabilities.formats.some((format) => sameFormat(format, options.format)))
        throw speechError('unsupported');
    if (options.signal.aborted)
        throw speechError('cancelled');
    const { controller, dispose } = linkedAbort(options.signal);
    let iterator;
    try {
        iterator = options.adapter
            .synthesize({
            text: options.text,
            voice: options.voice,
            speed: options.speed,
            language: options.language,
            format: options.format,
            signal: controller.signal,
        })[Symbol.asyncIterator]();
    }
    catch (error) {
        dispose();
        controller.abort();
        throw normalizeSpeechError(error);
    }
    let closed = false;
    const cleanup = async () => {
        if (closed)
            return;
        closed = true;
        controller.abort();
        dispose();
        controller.signal.removeEventListener('abort', abort);
        try {
            await iterator.return?.();
        }
        catch {
            /* Reader cancellation must still release the host. */
        }
    };
    let streamController;
    const abort = () => {
        if (!closed)
            streamController.error(speechError('cancelled'));
        void cleanup();
    };
    const stream = new ReadableStream({
        start(value) {
            streamController = value;
            controller.signal.addEventListener('abort', abort, { once: true });
        },
        async pull(value) {
            try {
                const result = await iterator.next();
                if (closed)
                    return;
                if (result.done) {
                    value.close();
                    await cleanup();
                }
                else {
                    if (!(result.value.audio instanceof Uint8Array) || !result.value.audio.length)
                        throw speechError('provider_error');
                    value.enqueue(result.value.audio);
                }
            }
            catch (error) {
                if (!closed)
                    value.error(normalizeSpeechError(error));
                await cleanup();
            }
        },
        async cancel() {
            await cleanup();
        },
    }, { highWaterMark: 0 });
    return {
        stream,
        format: options.format,
        mimeType: options.format.kind === 'encoded' ? options.format.mimeType : 'audio/pcm',
    };
}
export async function listVoices(options) {
    if (options.signal.aborted)
        throw speechError('cancelled');
    if (!options.adapter.listVoices) {
        if (options.adapter.capabilities.voices === 'none')
            return [];
        throw speechError('unsupported');
    }
    try {
        return await options.adapter.listVoices(options.signal);
    }
    catch (error) {
        throw normalizeSpeechError(error);
    }
}
//# sourceMappingURL=synthesis.js.map