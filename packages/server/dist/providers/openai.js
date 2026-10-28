import { speechError } from '../errors.js';
import { authHeaders, checkedFetch, endpoint, responseAudio } from '../transport.js';
import { websocketStt } from './session.js';
const pcm = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const formats = [
    pcm,
    { kind: 'encoded', mimeType: 'audio/mpeg' },
    { kind: 'encoded', mimeType: 'audio/ogg; codecs=opus' },
];
const voices = [
    'alloy',
    'ash',
    'ballad',
    'coral',
    'echo',
    'fable',
    'nova',
    'onyx',
    'sage',
    'shimmer',
    'verse',
    'marin',
    'cedar',
];
/** OpenAI native GA transcription session, verified against realtime-transcription guide 2026-10-28. */
export function createOpenAIAdapters(config) {
    const base = config.baseUrl ?? 'https://api.openai.com/v1';
    const headers = authHeaders(config.apiKey);
    return {
        stt: {
            id: 'openai',
            capabilities: { live: true, interim: true, sampleRates: [24000] },
            open({ format, language, signal }) {
                if (format.encoding !== 'pcm_s16le' || format.sampleRate !== 24000 || format.channels !== 1)
                    throw speechError('unsupported');
                const url = endpoint(base, 'realtime');
                url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
                url.searchParams.set('intent', 'transcription');
                let revision = 0, tentative = '', completed = false;
                return websocketStt({
                    url,
                    headers,
                    signal,
                    start: {
                        type: 'session.update',
                        session: {
                            type: 'transcription',
                            audio: {
                                input: {
                                    format: { type: 'audio/pcm', rate: 24000 },
                                    transcription: {
                                        model: config.model || 'gpt-live-transcribe',
                                        ...(language
                                            ? config.model === 'gpt-live-transcribe' || !config.model
                                                ? { languages: [language] }
                                                : { language }
                                            : {}),
                                    },
                                    turn_detection: null,
                                },
                            },
                        },
                    },
                    audio: (audio) => JSON.stringify({
                        type: 'input_audio_buffer.append',
                        audio: Buffer.from(audio).toString('base64'),
                    }),
                    stop: { type: 'input_audio_buffer.commit' },
                    emptyEnd: true,
                    parse(event) {
                        if (event.type === 'error' ||
                            event.type === 'conversation.item.input_audio_transcription.failed')
                            throw speechError('provider_error');
                        if (event.type === 'session.updated')
                            return { ready: true };
                        if (event.type === 'conversation.item.input_audio_transcription.delta') {
                            if (typeof event.delta !== 'string' || tentative.length + event.delta.length > 32000)
                                throw speechError('provider_error');
                            tentative += event.delta;
                            return { events: [{ type: 'partial', revision: revision++, text: tentative }] };
                        }
                        if (event.type === 'conversation.item.input_audio_transcription.completed' &&
                            !completed) {
                            if (typeof event.transcript !== 'string' || event.transcript.length > 32000)
                                throw speechError('provider_error');
                            completed = true;
                            return {
                                events: [{ type: 'final', mode: 'append', text: event.transcript }],
                                done: true,
                            };
                        }
                        return {};
                    },
                });
            },
        },
        tts: {
            id: 'openai',
            capabilities: { streamingAudio: true, streamingText: false, formats, voices: 'fixed' },
            async listVoices(signal) {
                signal.throwIfAborted();
                return voices.map((id) => ({ id, name: id }));
            },
            async *synthesize(request) {
                if (request.voice && !voices.includes(request.voice))
                    throw speechError('invalid_message');
                if (request.speed !== undefined &&
                    (!Number.isFinite(request.speed) || request.speed < 0.25 || request.speed > 4))
                    throw speechError('invalid_message');
                const format = request.format;
                const response_format = format.kind === 'pcm' &&
                    format.sampleRate === 24000 &&
                    format.channels === 1 &&
                    format.encoding === 'pcm_s16le'
                    ? 'pcm'
                    : format.kind === 'encoded' && format.mimeType === 'audio/mpeg'
                        ? 'mp3'
                        : format.kind === 'encoded' && format.mimeType === 'audio/ogg; codecs=opus'
                            ? 'opus'
                            : undefined;
                if (!response_format)
                    throw speechError('unsupported');
                const response = await checkedFetch(endpoint(base, 'audio/speech'), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    signal: request.signal,
                    body: JSON.stringify({
                        model: config.model || 'gpt-4o-mini-tts',
                        input: request.text,
                        voice: request.voice ?? 'alloy',
                        response_format,
                        stream_format: 'audio',
                        ...(request.speed === undefined ? {} : { speed: request.speed }),
                    }),
                });
                yield* responseAudio(response);
            },
        },
    };
}
//# sourceMappingURL=openai.js.map