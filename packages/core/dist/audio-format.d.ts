import { z } from 'zod';
import type { AudioFormat } from './provider.js';
export declare const audioFormatSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"pcm">;
    encoding: z.ZodLiteral<"pcm_s16le">;
    sampleRate: z.ZodNumber;
    channels: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>;
}, z.core.$strict>, z.ZodObject<{
    kind: z.ZodLiteral<"encoded">;
    mimeType: z.ZodString;
}, z.core.$strict>], "kind">;
/** Parse explicit metadata; audio/L16 is big endian, not PCM s16le.
 * A provider's selected format may fill in absent/incomplete metadata, never contradictions. */
export declare function audioFormatFromHeaders(headers: Pick<Headers, 'get'>, fallback?: AudioFormat): AudioFormat;
