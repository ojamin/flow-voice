import { z } from 'zod';
/** Known endpoint families; capability discovery belongs to the adapter, not this list. */
export const PROVIDER_IDS = [
    'openai',
    'elevenlabs',
    'cartesia',
    'xai',
    'azure',
    'google',
    'deepgram',
    'groq',
    'assemblyai',
    'mistral',
    'moss-compat',
    'speechmatics',
    'gladia',
    'rev.ai',
    'fake',
];
export const voiceSchema = z.strictObject({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    language: z.string().trim().min(1).max(64).optional(),
    isDefault: z.boolean().optional(),
});
export const DEFAULT_LIMITS = {
    /** No session cap: dictation lasts until it is stopped. Hosts may still set one. */
    maxSessionMs: Number.POSITIVE_INFINITY,
    /** Per synthesis request. Speech sections stay far below it; messages are not capped. */
    maxTextChars: 4_000,
    maxFrameBytes: 32_000,
    maxBufferedAudioBytes: 320_000,
    finalizationMs: 10_000,
    /** The player queues a whole reply, however long. */
    maxQueuedSections: Number.POSITIVE_INFINITY,
};
/** Browser timers fire at once past this delay, so longer limits mean "no limit". */
export const MAX_TIMER_MS = 2_147_483_647;
//# sourceMappingURL=provider.js.map