import { pcmInputSchema } from '@flow-voice/core';
import { apiKey, providerUrl } from '../transport.js';
import { nativeSession } from './native-session.js';
import { speechError as providerError } from '../errors.js';
function closeCode(code, reason) {
    if (code === 1008)
        return reason === 'Unauthorized Connection: Too many concurrent sessions'
            ? 'rate_limited'
            : 'unauthorized';
    if (code === 3008)
        return 'limit_exceeded';
    if (code === 3006 || code === 3007)
        return 'invalid_message';
    return code === 3005 || code === 1011 ? 'provider_error' : 'transport_error';
}
/** Universal Streaming v3, not the deprecated v2 realtime protocol.
 * https://www.assemblyai.com/docs/api-reference/streaming/realtime
 * https://www.assemblyai.com/docs/streaming/common-session-errors-and-closures
 */
export function createAssemblyAIAdapters(config) {
    return {
        stt: {
            id: 'assemblyai',
            capabilities: {
                live: true,
                interim: true,
                sampleRates: [8000, 16000, 22050, 24000, 44100, 48000],
            },
            open({ format, language, signal }) {
                pcmInputSchema.parse(format);
                const url = providerUrl({ ...config, baseUrl: config.baseUrl ?? 'wss://streaming.assemblyai.com' }, '/v3/ws', true);
                url.searchParams.set('sample_rate', String(format.sampleRate));
                url.searchParams.set('encoding', 'pcm_s16le');
                url.searchParams.set('format_turns', 'true');
                url.searchParams.set('speech_model', config.model || 'universal-streaming-english');
                if (language) {
                    if (!/^universal-3-[56]-pro$/.test(config.model))
                        throw providerError('unsupported');
                    url.searchParams.set('language_codes', JSON.stringify([language]));
                }
                let revision = 0;
                let hasCommitted = false;
                let lastFinal = -1;
                let pending;
                function commit(emit) {
                    if (!pending)
                        return;
                    if (pending.text.trim()) {
                        emit({ type: 'final', mode: 'append', text: (hasCommitted ? ' ' : '') + pending.text });
                        hasCommitted = true;
                    }
                    lastFinal = pending.turn;
                    pending = undefined;
                }
                return nativeSession({
                    url,
                    authorization: apiKey(config),
                    signal,
                    endMessage: JSON.stringify({ type: 'Terminate' }),
                    startMessage: 'Begin',
                    waitForTermination: true,
                    closeCode,
                    // v3 requires 50–1000 ms binary frames. Aggregate short capture frames to 100 ms;
                    // pad only the final sub-50 ms tail with silence, never drop real samples.
                    chunkBytes: Math.round(format.sampleRate / 10) * 2,
                    minChunkBytes: Math.ceil(format.sampleRate / 20) * 2,
                    message(value, emit, complete) {
                        if (value.type === 'Error' || value.error)
                            throw providerError(typeof value.error_code === 'number'
                                ? closeCode(value.error_code, typeof value.error === 'string' ? value.error : '')
                                : 'provider_error');
                        if (value.type === 'Termination') {
                            commit(emit);
                            complete();
                            return;
                        }
                        if (value.type !== 'Turn')
                            return;
                        if (typeof value.transcript !== 'string' ||
                            !Number.isInteger(value.turn_order) ||
                            Number(value.turn_order) < 0 ||
                            typeof value.end_of_turn !== 'boolean' ||
                            typeof value.turn_is_formatted !== 'boolean')
                            throw providerError('provider_error');
                        const turn = Number(value.turn_order);
                        if (turn <= lastFinal)
                            return; // formatted retransmission must not duplicate a segment
                        if (pending && turn > pending.turn)
                            commit(emit);
                        if (value.end_of_turn) {
                            pending = { turn, text: value.transcript };
                            if (value.turn_is_formatted === true)
                                commit(emit);
                            else
                                emit({ type: 'partial', revision: ++revision, text: value.transcript });
                        }
                        else
                            emit({ type: 'partial', revision: ++revision, text: value.transcript });
                    },
                });
            },
        },
    };
}
//# sourceMappingURL=assemblyai.js.map