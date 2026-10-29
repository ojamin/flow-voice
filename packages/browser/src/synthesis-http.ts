import { SYNTHESIS_HEADERS } from '@flow-voice/core';
import type { AudioFormat, SpeechError, SynthesisAudio } from '@flow-voice/core';

/** Decode a successful synthesis response. Hosts handle HTTP error responses themselves. */
export async function synthesisAudioFromResponse(response: Response): Promise<SynthesisAudio> {
  const mimeType = response.headers.get(SYNTHESIS_HEADERS.contentType)?.trim() ?? '';
  const mediaType = mimeType.split(';')[0]!.trim().toLowerCase();
  const sampleRate = response.headers.get(SYNTHESIS_HEADERS.sampleRate);
  const channels = response.headers.get(SYNTHESIS_HEADERS.channels);
  const encoding = response.headers.get(SYNTHESIS_HEADERS.encoding);
  let format: AudioFormat | undefined;
  if (mediaType === 'audio/pcm') {
    if (sampleRate !== null && /^\d+$/.test(sampleRate) &&
      Number.isSafeInteger(Number(sampleRate)) && Number(sampleRate) > 0 &&
      (channels === '1' || channels === '2') && encoding === 'pcm_s16le') {
      format = { kind: 'pcm', sampleRate: Number(sampleRate), channels: Number(channels) as 1 | 2, encoding };
    }
  } else if (/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mediaType) &&
    sampleRate === null && channels === null && encoding === null) {
    format = { kind: 'encoded', mimeType };
  }
  if (!format || !response.body) {
    const error: Error & SpeechError = Object.assign(new Error('Invalid synthesis audio metadata.'), {
      code: 'invalid_message' as const,
    });
    try {
      await response.body?.cancel();
    } catch {
      // Invalid metadata remains the error even if transport cleanup fails.
    }
    throw error;
  }
  return { mimeType, format, stream: response.body };
}
