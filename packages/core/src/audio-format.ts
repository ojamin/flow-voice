import { z } from 'zod';
import type { AudioFormat } from './provider.js';

export const audioFormatSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('pcm'), encoding: z.literal('pcm_s16le'),
    sampleRate: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), channels: z.union([z.literal(1), z.literal(2)]) }),
  z.strictObject({ kind: z.literal('encoded'), mimeType: z.string().trim().regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:\s*;[^\r\n]+)?$/) }),
]);

/** Parse explicit metadata; audio/L16 is big endian, not PCM s16le.
 * A provider's selected format may fill in absent/incomplete metadata, never contradictions. */
export function audioFormatFromHeaders(headers: Pick<Headers, 'get'>, fallback?: AudioFormat): AudioFormat {
  const invalid = (): never => { throw Object.assign(new Error('Invalid synthesis audio metadata.'), { code: 'invalid_message' as const }); };
  const mimeType = headers.get('content-type')?.trim() ?? '';
  const [type, ...parameters] = mimeType.split(';');
  const mediaType = type!.trim().toLowerCase();
  const params = new Map<string, string>();
  for (const parameter of parameters) {
    const match = /^\s*([\w-]+)\s*=\s*(?:"([^"\r\n]*)"|([^\s";]+))\s*$/.exec(parameter);
    if (!match) return invalid();
    const key = match[1]!.toLowerCase();
    if (params.has(key)) return invalid();
    params.set(key, (match[2] ?? match[3])!);
  }
  const encoding = headers.get('x-audio-encoding');
  const rate = headers.get('x-audio-sample-rate');
  const channels = headers.get('x-audio-channels');
  if (!mimeType && encoding === null && rate === null && channels === null && fallback) return fallback;
  if (mediaType !== 'audio/pcm') {
    if (mediaType === 'audio/l16' || encoding !== null || rate !== null || channels !== null ||
      !audioFormatSchema.safeParse({ kind: 'encoded', mimeType }).success) return invalid();
    if (fallback?.kind === 'encoded' && !parameters.length &&
      fallback.mimeType.split(';')[0]!.trim().toLowerCase() === mediaType) return fallback;
    return { kind: 'encoded', mimeType };
  }
  if ([...params.keys()].some((key) => !['rate', 'channels', 'encoding'].includes(key))) return invalid();
  const number = (values: (string | null | undefined)[]) => {
    const present = values.filter((value): value is string => value != null);
    if (!present.length) return undefined;
    if (present.some((value) => !/^\d+$/.test(value.trim()))) return invalid();
    const nums = present.map(Number);
    if (nums.some((n) => !Number.isSafeInteger(n) || n <= 0 || n !== nums[0])) return invalid();
    return nums[0]!;
  };
  const encodings = [encoding, params.get('encoding')].filter((value) => value != null);
  if (encodings.some((value) => value!.trim().toLowerCase() !== 'pcm_s16le')) return invalid();
  const sampleRate = number([rate, params.get('rate')]);
  const count = number([channels, params.get('channels')]);
  if (count !== undefined && count !== 1 && count !== 2) return invalid();
  if (!encodings.length || sampleRate === undefined || count === undefined) return fallback ?? invalid();
  return { kind: 'pcm', encoding: 'pcm_s16le', sampleRate, channels: count };
}
