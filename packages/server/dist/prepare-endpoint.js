import { validateSpeechEndpointDraft } from '@flow-voice/core';
import { createAdapters } from './registry.js';
import { speechError } from './errors.js';
/** Host authorizes, binds credentials and applies URL policy before calling this. */
export function prepareSpeechEndpoint(options) {
    const validated = validateSpeechEndpointDraft(options.draft);
    if (!validated.ok)
        throw speechError('invalid_message');
    const draft = validated.value;
    if (draft.provider === 'fake' && !options.createAdapters)
        throw speechError('unsupported');
    const adapters = (options.createAdapters ?? createAdapters)({
        provider: draft.provider, model: draft.model, baseUrl: draft.baseUrl ?? undefined,
        apiKey: options.apiKey ?? draft.apiKey, options: { ...draft.options },
    }, { fetch: options.fetch, webSocket: options.webSocket });
    if (!adapters[options.kind])
        throw speechError('unsupported');
    return adapters;
}
//# sourceMappingURL=prepare-endpoint.js.map