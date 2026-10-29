import type { AudioFormat, SynthesisAudio, SynthesisRequest } from '@flow-voice/core';
import { audioFormatFromHeaders } from '@flow-voice/core';
import type { AudioChunk, TtsAdapter } from './index.js';
import { normalizeSpeechError, speechError } from './errors.js';
import { linkedAbort } from './transport.js';

/** Own the response reader immediately, so abort before the first pull cancels it too. */
export function audioFromResponse(response: Response, format: AudioFormat, signal: AbortSignal): SynthesisAudio {
  if (signal.aborted) throw speechError('cancelled');
  if (!response.body) throw speechError('provider_error');
  const reader = response.body.getReader();
  return audioFromChunks(() => ({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = await reader.read();
          return result.done ? { done: true, value: undefined } : { done: false, value: { audio: result.value } };
        },
        async return() {
          try { await reader.cancel(); } catch { /* Preserve original failure. */ }
          finally { reader.releaseLock(); }
          return { done: true, value: undefined };
        },
      };
    },
  }), format, signal, true);
}

function selectedFormat(adapter: TtsAdapter, request: SynthesisRequest & { format?: AudioFormat }): AudioFormat {
  const format = request.format ?? adapter.capabilities.formats[0];
  if (!format || !adapter.capabilities.formats.some((candidate) => candidate.kind === 'encoded'
    ? format.kind === 'encoded' && candidate.mimeType === format.mimeType
    : format.kind === 'pcm' && candidate.encoding === format.encoding && candidate.sampleRate === format.sampleRate && candidate.channels === format.channels))
    throw speechError('unsupported');
  return format;
}

/** Adapt request-selected non-HTTP audio protocols without buffering their audio. */
export function requestedSynthesis(
  generate: (request: SynthesisRequest & { format: AudioFormat; signal: AbortSignal }) => AsyncIterable<AudioChunk>,
): TtsAdapter['synthesize'] {
  return async function (this: TtsAdapter, request) {
    const format = selectedFormat(this, request);
    return audioFromChunks((signal) => generate({ ...request, format, signal }), format, request.signal);
  };
}

/** HTTP metadata describes the actual output, even when it differs from the selection. */
export function requestedHttpSynthesis(
  generate: (request: SynthesisRequest & { format: AudioFormat; signal: AbortSignal }) => Promise<Response>,
): TtsAdapter['synthesize'] {
  return async function (this: TtsAdapter, request) {
    const format = selectedFormat(this, request);
    if (request.signal.aborted) throw speechError('cancelled');
    const response = await generate({ ...request, format });
    try {
      return audioFromResponse(response, audioFormatFromHeaders(response.headers, format), request.signal);
    } catch (error) {
      try { await response.body?.cancel(); } catch { /* Preserve metadata failure. */ }
      throw error;
    }
  };
}

export function audioFromChunks(
  generate: (signal: AbortSignal) => AsyncIterable<AudioChunk>,
  format: AudioFormat,
  signal: AbortSignal,
  validateFrames = false,
): SynthesisAudio {
  if (signal.aborted) throw speechError('cancelled');
  const link = linkedAbort(signal);
  const iterator = generate(link.controller.signal)[Symbol.asyncIterator]();
  let closed = false;
  let bytes = 0;
  let output: ReadableStreamDefaultController<Uint8Array>;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    link.controller.signal.removeEventListener('abort', abort);
    link.controller.abort();
    link.dispose();
    try { await iterator.return?.(); } catch { /* Preserve terminal result. */ }
  };
  const abort = () => {
    if (!closed) output.error(speechError('cancelled'));
    void cleanup();
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      output = controller;
      link.controller.signal.addEventListener('abort', abort, { once: true });
      if (link.controller.signal.aborted) abort();
    },
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (closed) return;
        if (result.done) {
          if (validateFrames && format.kind === 'pcm' && (!bytes || bytes % (format.channels * 2)))
            throw speechError('provider_error');
          controller.close();
          await cleanup();
        } else {
          if (!(result.value.audio instanceof Uint8Array) || !result.value.audio.length) throw speechError('provider_error');
          bytes += result.value.audio.length;
          controller.enqueue(result.value.audio);
        }
      } catch (error) {
        if (!closed) controller.error(normalizeSpeechError(error));
        await cleanup();
      }
    },
    async cancel() { await cleanup(); },
  }, { highWaterMark: 0 });
  return { stream, format, mimeType: format.kind === 'encoded' ? format.mimeType : 'audio/pcm' };
}
