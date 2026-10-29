import { listVoices } from './synthesis.js';
const MAX_ENDPOINTS = 32;
/** `endpoint` identifies the provider configuration (for example its base URL and key
 * fingerprint); a changed configuration must use a new endpoint key. */
export function createVoiceCatalog(options = {}) {
    const ttlMs = options.ttlMs ?? 60_000;
    const now = options.now ?? Date.now;
    const cache = new Map();
    const catalog = {
        async refresh(endpoint, adapter, signal) {
            const voices = await listVoices({ adapter, signal });
            cache.delete(endpoint);
            cache.set(endpoint, { voices, expires: now() + ttlMs });
            if (cache.size > MAX_ENDPOINTS)
                cache.delete(cache.keys().next().value);
            return voices;
        },
        async get(endpoint, adapter, signal) {
            const cached = cache.get(endpoint);
            return cached && cached.expires > now() ? cached.voices : catalog.refresh(endpoint, adapter, signal);
        },
    };
    return catalog;
}
//# sourceMappingURL=catalog.js.map