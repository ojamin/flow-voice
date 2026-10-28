/** Deterministic network-free fixtures. A final is emitted for each accepted frame, followed
 * by ended. Text/PCM are synthetic; this does not model recognition quality or timing. */
export function createFakeAdapters(options = {}) {
    const format = {
        kind: 'pcm',
        encoding: 'pcm_s16le',
        sampleRate: 16000,
        channels: 1,
    };
    return {
        stt: {
            id: 'fake',
            capabilities: { live: true, interim: true, sampleRates: [16000] },
            open({ signal }) {
                const queue = [];
                let ended = false, revision = 0;
                let wake;
                const notify = () => {
                    wake?.();
                    wake = undefined;
                };
                const close = () => {
                    if (!ended) {
                        if (signal.aborted)
                            queue.length = 0;
                        ended = true;
                        queue.push({ type: 'ended', reason: signal.aborted ? 'cancelled' : 'stopped' });
                        notify();
                    }
                    signal.removeEventListener('abort', close);
                };
                if (signal.aborted)
                    close();
                else
                    signal.addEventListener('abort', close, { once: true });
                return {
                    write(pcm) {
                        if (ended)
                            throw new Error('Fake STT session ended');
                        if (!pcm.length || pcm.length % 2 || pcm.length > 32000 || queue.length > 62)
                            throw new RangeError('Fake PCM limit exceeded');
                        const text = options.transcript ?? 'test transcript';
                        queue.push({ type: 'partial', revision: revision++, text }, { type: 'final', mode: 'append', text });
                        notify();
                    },
                    async end() {
                        close();
                    },
                    events: {
                        async *[Symbol.asyncIterator]() {
                            try {
                                while (true) {
                                    while (queue.length)
                                        yield queue.shift();
                                    if (ended)
                                        return;
                                    await new Promise((resolve) => {
                                        wake = resolve;
                                    });
                                }
                            }
                            finally {
                                close();
                                queue.length = 0;
                            }
                        },
                    },
                };
            },
        },
        tts: {
            id: 'fake',
            capabilities: {
                streamingAudio: true,
                streamingText: false,
                formats: [format],
                voices: 'fixed',
            },
            async *synthesize({ signal }) {
                signal.throwIfAborted();
                yield { audio: (options.pcm ?? new Uint8Array([0, 0, 1, 0])).slice() };
            },
            async listVoices(signal) {
                signal.throwIfAborted();
                return [{ id: 'fake', name: 'Test voice' }];
            },
        },
    };
}
//# sourceMappingURL=testing.js.map