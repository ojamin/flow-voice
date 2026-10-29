import { DEFAULT_LIMITS } from '@flow-voice/core';
import type { SynthesisAudio, Voice } from '@flow-voice/core';
import type { SynthesizeOptions, VoiceListOptions } from './index.js';
import { normalizeSpeechError, speechError } from './errors.js';

/** Select within a catalog; an unavailable/empty catalog permits host-supplied ids. */
export function resolveVoice({
  voices,
  requested,
  configured,
}: {
  voices: readonly Voice[];
  requested?: string;
  configured?: string;
}): string | undefined {
  if (!voices.length) return requested ?? configured;
  return voices.find((voice) => voice.id === requested)?.id
    ?? voices.find((voice) => voice.id === configured)?.id
    ?? voices.find((voice) => voice.isDefault)?.id
    ?? voices[0]!.id;
}

export async function synthesize(options: SynthesizeOptions): Promise<SynthesisAudio> {
  const max = options.maxTextChars ?? DEFAULT_LIMITS.maxTextChars;
  if (!Number.isSafeInteger(max) || max <= 0 || max > DEFAULT_LIMITS.maxTextChars)
    throw speechError('invalid_message');
  if (typeof options.text !== 'string' || !options.text.trim())
    throw speechError('invalid_message');
  if (options.text.length > max) throw speechError('limit_exceeded');
  if (
    options.voice !== undefined &&
    (typeof options.voice !== 'string' || !options.voice.trim() || options.voice.length > 200)
  )
    throw speechError('invalid_message');
  if (options.speed !== undefined && (!Number.isFinite(options.speed) || options.speed <= 0))
    throw speechError('invalid_message');
  if (options.signal.aborted) throw speechError('cancelled');
  try {
    return await options.adapter
      .synthesize({
        text: options.text,
        voice: options.voice,
        speed: options.speed,
        language: options.language,
        format: options.format,
        signal: options.signal,
      });
  } catch (error) {
    throw normalizeSpeechError(error);
  }
}
export async function listVoices(options: VoiceListOptions): Promise<readonly Voice[]> {
  if (options.signal.aborted) throw speechError('cancelled');
  if (!options.adapter.listVoices) {
    if (options.adapter.capabilities.voices === 'none') return [];
    throw speechError('unsupported');
  }
  try {
    return await options.adapter.listVoices(options.signal);
  } catch (error) {
    throw normalizeSpeechError(error);
  }
}
