import { speechError } from './errors.js';
import { nativeProviderFactories } from './providers/registry.js';
const providers = nativeProviderFactories;
export function createAdapters(config) {
    const factory = Object.hasOwn(providers, config.provider)
        ? providers[config.provider]
        : undefined;
    if (!factory)
        throw speechError('unsupported');
    if (config.baseUrl) {
        let url;
        try {
            url = new URL(config.baseUrl);
        }
        catch {
            throw speechError('invalid_message');
        }
        if (!['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash)
            throw speechError('invalid_message');
    }
    return factory(config);
}
//# sourceMappingURL=registry.js.map