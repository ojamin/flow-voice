import { z } from 'zod';
import { audioFormatSchema } from './audio-format.js';
export const speechEndpointOptionsSchema = z.strictObject({
    voice: z.string().trim().min(1).max(200).optional(),
    speed: z.number({ error: 'Speed must be between 0.5 and 2.' }).min(0.5, 'Speed must be between 0.5 and 2.').max(2, 'Speed must be between 0.5 and 2.').optional(),
    language: z.string().trim().min(1).max(64).optional(),
    sttTransport: z.enum(['realtime', 'rest']).optional(),
    format: audioFormatSchema.optional(),
});
const draftSchema = z.strictObject({
    provider: z.string().trim().min(1, 'Choose a provider.').max(64).regex(/^[a-z][a-z0-9.-]*$/),
    model: z.string().trim().min(1, 'Enter a model.').max(200),
    baseUrl: z.string().trim().max(2048).nullable().optional(),
    apiKey: z.string().trim().min(1).max(8192).optional(),
    options: speechEndpointOptionsSchema.optional(),
});
function normalizeUrl(value) {
    if (!value)
        return null;
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.search || url.hash || value.includes('?') || value.includes('#'))
        throw new Error('Invalid endpoint URL');
    return url.href.replace(/\/+$/, '');
}
/** Syntax and key binding only; hosts still authorize and apply their URL policy. */
export function validateSpeechEndpointDraft(value, previous) {
    const result = draftSchema.safeParse(value);
    if (!result.success)
        return { ok: false, issues: result.error.issues.map((issue) => ({
                path: issue.path.map(String), message: issue.message,
            })) };
    const draft = result.data;
    try {
        draft.baseUrl = normalizeUrl(draft.baseUrl);
        if (previous && !draft.apiKey && (previous.provider !== draft.provider ||
            normalizeUrl(previous.baseUrl) !== draft.baseUrl))
            return { ok: false, issues: [
                    { path: ['apiKey'], message: 'Enter a new API key when changing the provider or base URL.' },
                ] };
    }
    catch {
        return { ok: false, issues: [{ path: ['baseUrl'], message: 'Use an HTTP(S) URL without credentials, query or fragment.' }] };
    }
    return { ok: true, value: draft };
}
//# sourceMappingURL=endpoint-config.js.map