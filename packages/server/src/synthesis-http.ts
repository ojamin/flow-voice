import { audioFormatFromHeaders, SYNTHESIS_HEADERS } from '@flow-voice/core';
import type { SynthesisAudio } from '@flow-voice/core';
import { normalizeSpeechError } from './errors.js';

/** Await the first chunk before the host commits headers, without buffering the audio. */
export async function synthesisResponse(audio: SynthesisAudio): Promise<{
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}> {
  const reader = audio.stream.getReader();
  let first: ReadableStreamReadResult<Uint8Array>;
  try {
    first = await reader.read();
  } catch (error) {
    reader.releaseLock();
    throw normalizeSpeechError(error);
  }
  const headers: Record<string, string> = {
    [SYNTHESIS_HEADERS.contentType]: audio.format.kind === 'pcm' ? 'audio/pcm' : audio.format.mimeType,
    [SYNTHESIS_HEADERS.cacheControl]: 'no-store',
  };
  if (audio.format.kind === 'pcm') {
    headers[SYNTHESIS_HEADERS.sampleRate] = String(audio.format.sampleRate);
    headers[SYNTHESIS_HEADERS.channels] = String(audio.format.channels);
    headers[SYNTHESIS_HEADERS.encoding] = audio.format.encoding;
  }
  try {
    audioFormatFromHeaders(new Headers(headers));
  } catch (error) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    throw normalizeSpeechError(error);
  }
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) {
        controller.close();
        reader.releaseLock();
      } else {
        controller.enqueue(first.value);
      }
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (cancelled) return;
        if (result.done) {
          controller.close();
          reader.releaseLock();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        if (cancelled) return;
        controller.error(normalizeSpeechError(error));
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      cancelled = true;
      try {
        await reader.cancel(reason);
      } finally {
        reader.releaseLock();
      }
    },
  }, { highWaterMark: 0 });
  return { headers, body };
}
