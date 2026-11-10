import { createStreamingSpeechExtractor } from '@flow-voice/core';
export function createAutoReader(options) {
    let enabled = options.enabled;
    let route = options.routeIdentity;
    let excluded = new Set();
    const extractors = new Map();
    const rejected = new Set();
    const seed = (newRoute = false) => {
        excluded = new Set([
            ...(newRoute ? [] : excluded),
            ...(newRoute ? [] : extractors.keys()),
            ...(newRoute ? [] : rejected),
            ...options.messages.getSnapshot().map((message) => message.id),
        ]);
        extractors.clear();
        rejected.clear();
    };
    seed();
    function reject(message) {
        rejected.add(message.id);
        extractors.delete(message.id);
    }
    const unsubscribe = options.messages.subscribe(({ message, source }) => {
        if (!enabled || source !== 'live') {
            excluded.add(message.id);
            return;
        }
        if (excluded.has(message.id) || rejected.has(message.id))
            return;
        const preference = options.preferences?.(message.agentName);
        if (message.own || preference?.muted || (options.filter && !options.filter(message))) {
            reject(message);
            return;
        }
        let extractor = extractors.get(message.id);
        if (!extractor) {
            if (extractors.size >= 2048) {
                reject(message);
                return;
            }
            extractor = createStreamingSpeechExtractor();
            extractors.set(message.id, extractor);
        }
        try {
            const sections = extractor.push(message.markdown, message.complete);
            if (extractor.malformed) {
                options.player.stop();
                reject(message);
                return;
            }
            if (sections.length || message.complete)
                options.player.append({
                    id: message.id,
                    complete: message.complete,
                    sections,
                    voice: preference?.voice,
                    speed: preference?.speed,
                });
            if (message.complete)
                reject(message);
        }
        catch {
            options.player.stop();
            reject(message);
        }
    });
    return {
        setEnabled(value) {
            if (value === enabled)
                return;
            enabled = value;
            seed();
            if (!value)
                options.player.stop();
        },
        setRouteIdentity(value) {
            if (Object.is(value, route))
                return;
            route = value;
            options.player.stop();
            seed(true);
        },
        dispose() {
            unsubscribe();
            extractors.clear();
            rejected.clear();
            excluded.clear();
            options.player.stop();
        },
    };
}
//# sourceMappingURL=reader.js.map