import { audioFormatFromHeaders } from '@flow-voice/core';
import type { SynthesisAudio } from '@flow-voice/core';

/** Decode a successful synthesis response. Hosts handle HTTP error responses themselves. */
export async function synthesisAudioFromResponse(response: Response): Promise<SynthesisAudio> {
  try {
    const format = audioFormatFromHeaders(response.headers);
    if (!response.body) throw Object.assign(new Error('Missing synthesis body.'), { code: 'invalid_message' });
    return { mimeType: response.headers.get('content-type')!.trim(), format, stream: response.body };
  } catch (error) {
    try {
      await response.body?.cancel();
    } catch {
      // Invalid metadata remains the error even if transport cleanup fails.
    }
    throw error;
  }
}
