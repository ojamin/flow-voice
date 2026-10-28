import { DEFAULT_LIMITS, sttClientMessageSchema } from '@flow-voice/core';
import { normalizeSpeechError, speechError } from './errors.js';
/** Transport-neutral runner. Host input and output are serialized; no audio is silently dropped. */
export function createLiveTranscriptionSession(options) {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    for (const key of [
        'maxSessionMs',
        'maxFrameBytes',
        'maxBufferedAudioBytes',
        'finalizationMs',
    ]) {
        if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > DEFAULT_LIMITS[key])
            throw speechError('invalid_message');
    }
    const controller = new AbortController();
    let session;
    let iterator;
    let state = 'idle';
    const isEnded = () => state === 'ended';
    let stopReason = 'stopped';
    let committed = '', tentative = '', revision = 0, adapterRevision = -1;
    let bufferedBytes = 0, queued = 0;
    let input = Promise.resolve(), output = Promise.resolve();
    let timer;
    let finalTimer;
    let resolveDone;
    const done = new Promise((resolve) => {
        resolveDone = resolve;
    });
    const send = (message) => {
        const next = output.then(() => options.send(message));
        // Failed delivery must not leave an unhandled rejection or prevent cleanup.
        output = next.catch(() => { });
        return next;
    };
    let finishing;
    const finish = (reason, error) => {
        if (finishing)
            return finishing;
        state = 'ended';
        clearTimeout(timer);
        clearTimeout(finalTimer);
        options.signal.removeEventListener('abort', abort);
        controller.abort();
        finishing = (async () => {
            try {
                if (error) {
                    const safe = normalizeSpeechError(error);
                    await send({ type: 'error', code: safe.code, message: safe.message });
                }
                if (reason === 'stopped' || reason === 'limit')
                    await send({ type: 'final', revision: revision++, text: committed });
                await send({ type: 'ended', reason });
            }
            catch {
                /* A disconnected host cannot receive terminal messages. Still release upstream. */
            }
            finally {
                try {
                    await iterator?.return?.();
                }
                catch {
                    /* Provider cleanup errors are redacted and terminal. */
                }
                resolveDone();
            }
        })();
        return finishing;
    };
    const abort = () => {
        void finish('cancelled');
    };
    const partial = async () => {
        if (committed.length + tentative.length > 32000)
            throw speechError('limit_exceeded');
        await send({ type: 'partial', revision: revision++, committed, tentative });
    };
    const consume = async () => {
        iterator = session.events[Symbol.asyncIterator]();
        try {
            while (state !== 'ended') {
                const result = await iterator.next();
                if (isEnded())
                    break;
                if (result.done) {
                    void finish('error', speechError('transport_error'));
                    break;
                }
                const event = result.value;
                if (event.type === 'partial') {
                    if (!Number.isSafeInteger(event.revision) || event.revision <= adapterRevision)
                        continue;
                    adapterRevision = event.revision;
                    tentative = event.text;
                    await partial();
                }
                else if (event.type === 'final') {
                    const next = event.mode === 'replace' ? event.text : committed + event.text;
                    if (next.length > 32000)
                        throw speechError('limit_exceeded');
                    committed = next;
                    tentative = '';
                    await partial();
                }
                else if (event.type === 'error') {
                    void finish(event.code === 'limit_exceeded' ? 'limit' : 'error', event);
                    break;
                }
                else {
                    void finish(event.reason === 'stopped' ? stopReason : event.reason, event.reason === 'error' ? speechError('provider_error') : undefined);
                    break;
                }
            }
        }
        catch (error) {
            if (state !== 'ended')
                void finish(normalizeSpeechError(error).code === 'limit_exceeded' ? 'limit' : 'error', error);
        }
    };
    const stop = () => {
        state = 'finalizing';
        clearTimeout(timer);
        finalTimer = setTimeout(() => {
            void finish('error', speechError('timeout'));
        }, limits.finalizationMs);
        void session.end().catch((error) => {
            void finish('error', error);
        });
    };
    if (options.signal.aborted)
        abort();
    else
        options.signal.addEventListener('abort', abort, { once: true });
    return {
        done,
        cancel: () => finish('cancelled'),
        receive(raw) {
            if (state === 'ended')
                return Promise.resolve();
            let message;
            try {
                message = sttClientMessageSchema.parse(raw);
            }
            catch {
                return finish('error', speechError('invalid_message'));
            }
            // Cancel bypasses a stalled input send; termination still awaits ordered output delivery.
            if (message.type === 'cancel')
                return finish('cancelled');
            const bytes = message.type === 'audio' ? message.audio.byteLength : 0;
            if (bytes > limits.maxFrameBytes ||
                bufferedBytes + bytes > limits.maxBufferedAudioBytes ||
                queued >= 64)
                return finish('limit', speechError('limit_exceeded'));
            bufferedBytes += bytes;
            queued++;
            // Input buffers belong to the caller; copy only while an admission is queued.
            if (message.type === 'audio')
                message = { type: 'audio', audio: message.audio.slice() };
            const admission = input
                .then(async () => {
                if (state === 'ended')
                    return;
                if (message.type === 'start') {
                    if (state !== 'idle')
                        throw speechError('invalid_message');
                    if (!options.adapter.capabilities.sampleRates.includes(message.audio.sampleRate))
                        throw speechError('unsupported');
                    state = 'listening';
                    session = options.adapter.open({
                        format: message.audio,
                        language: message.language,
                        signal: controller.signal,
                    });
                    timer = setTimeout(() => {
                        stopReason = 'limit';
                        stop();
                    }, limits.maxSessionMs);
                    await send({
                        type: 'ready',
                        audio: message.audio,
                        interim: options.adapter.capabilities.interim,
                    });
                    if (!isEnded())
                        void consume();
                }
                else if (message.type === 'audio') {
                    if (state !== 'listening')
                        throw speechError('invalid_message');
                    session.write(message.audio);
                }
                else if (message.type === 'stop') {
                    if (state !== 'listening')
                        throw speechError('invalid_message');
                    stop();
                }
            })
                .catch((error) => {
                void finish(normalizeSpeechError(error).code === 'limit_exceeded' ? 'limit' : 'error', error);
            })
                .finally(() => {
                bufferedBytes -= bytes;
                queued--;
            });
            input = admission;
            return admission;
        },
    };
}
//# sourceMappingURL=runner.js.map