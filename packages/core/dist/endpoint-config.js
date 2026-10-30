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
    apiKey: z.string().trim().max(8192).optional(),
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
function origin(value) {
    const normalized = normalizeUrl(value);
    return normalized ? new URL(normalized).origin : null;
}
/** Literal loopback/private addresses only; hosts still apply their own URL policy. */
export function isLocalSpeechEndpoint(value) {
    if (!value)
        return false;
    try {
        const host = new URL(value).hostname;
        if (host === 'localhost' || host === '[::1]')
            return true;
        const parts = host.split('.').map(Number);
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
            return false;
        const [a, b] = parts;
        return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
    }
    catch {
        return false;
    }
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
        if (draft.apiKey === '') {
            if (!isLocalSpeechEndpoint(draft.baseUrl))
                return { ok: false, issues: [
                        { path: ['apiKey'], message: 'Enter an API key.' },
                    ] };
            delete draft.apiKey;
        }
        if (previous && !draft.apiKey && (previous.provider !== draft.provider ||
            origin(previous.baseUrl) !== origin(draft.baseUrl)))
            return { ok: false, issues: [
                    { path: ['apiKey'], message: 'Enter a new API key when changing the provider or endpoint origin.' },
                ] };
    }
    catch {
        return { ok: false, issues: [{ path: ['baseUrl'], message: 'Use an HTTP(S) URL without credentials, query or fragment.' }] };
    }
    return { ok: true, value: draft };
}
//# sourceMappingURL=endpoint-config.js.map