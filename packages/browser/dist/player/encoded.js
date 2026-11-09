import { abortable, abortError, check, read } from './audio.js';
/** One media element for the whole player. MSE is used only for browser-advertised MIME types. */
export async function playEncoded(media, audio, signal, isPaused) {
    if (audio.format.kind !== 'encoded')
        throw new TypeError('Expected encoded audio');
    const reader = audio.stream.getReader();
    let url;
    let fail;
    const ended = new Promise((resolve, reject) => {
        fail = reject;
        media.onended = () => resolve();
        media.onerror = () => reject(new Error('Unable to decode speech audio'));
    });
    void ended.catch(() => { });
    const cancel = () => {
        media.pause();
        fail(abortError());
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        check(signal);
        const mse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(audio.format.mimeType);
        if (mse) {
            const source = new MediaSource();
            const opened = new Promise((resolve) => source.addEventListener('sourceopen', () => resolve(), { once: true }));
            url = URL.createObjectURL(source);
            media.src = url;
            await abortable(Promise.race([opened, ended]), signal);
            const buffer = source.addSourceBuffer(audio.format.mimeType);
            let size = 0;
            let started = false;
            const update = async (action) => {
                let done;
                let error;
                const completion = new Promise((resolve, reject) => {
                    done = () => resolve();
                    error = () => reject(new Error('Invalid encoded speech stream'));
                    buffer.addEventListener('updateend', done, { once: true });
                    buffer.addEventListener('error', error, { once: true });
                });
                try {
                    action();
                    await abortable(Promise.race([completion, ended]), signal);
                }
                finally {
                    buffer.removeEventListener('updateend', done);
                    buffer.removeEventListener('error', error);
                }
            };
            while (true) {
                const chunk = await Promise.race([
                    read(reader, signal),
                    ended.then(() => {
                        throw new Error('Audio ended before stream completed');
                    }),
                ]);
                if (chunk.done)
                    break;
                size += chunk.value.byteLength;
                if (size > 16 * 1024 * 1024)
                    throw new RangeError('Encoded speech exceeds playback limit');
                await update(() => buffer.appendBuffer(new Uint8Array(chunk.value)));
                if (!started && !isPaused()) {
                    started = true;
                    // play() may wait for more frames; keep feeding the stream while it settles.
                    void media.play().catch(fail);
                }
                if (media.currentTime > 10 &&
                    buffer.buffered.length &&
                    buffer.buffered.start(0) < media.currentTime - 10) {
                    await update(() => buffer.remove(0, media.currentTime - 10));
                }
            }
            check(signal);
            source.endOfStream();
            if (!started && !isPaused())
                void media.play().catch(fail);
            await abortable(ended, signal);
        }
        else {
            const chunks = [];
            let size = 0;
            while (true) {
                const chunk = await Promise.race([
                    read(reader, signal),
                    ended.then(() => {
                        throw new Error('Audio ended before stream completed');
                    }),
                ]);
                if (chunk.done)
                    break;
                size += chunk.value.byteLength;
                if (size > 16 * 1024 * 1024)
                    throw new RangeError('Encoded speech exceeds playback limit');
                chunks.push(new Uint8Array(chunk.value));
            }
            check(signal);
            url = URL.createObjectURL(new Blob(chunks, { type: audio.format.mimeType }));
            media.src = url;
            if (!isPaused())
                void media.play().catch(fail);
            await abortable(ended, signal);
        }
    }
    finally {
        signal.removeEventListener('abort', cancel);
        media.onended = null;
        media.onerror = null;
        media.pause();
        media.removeAttribute('src');
        media.load();
        if (url)
            URL.revokeObjectURL(url);
        void reader.cancel().catch(() => { });
        reader.releaseLock();
    }
}
//# sourceMappingURL=encoded.js.map