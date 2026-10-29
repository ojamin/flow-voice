import { DEFAULT_DICTATION_PREFERENCE, normalizeDictationPreference } from '@flow-voice/core';
/** Persisted speech choices. Storage that is unavailable or holds stale data never throws:
 * choices then last for the page's lifetime and the defaults apply. */
export function createSpeechPreferences(options = {}) {
    const voiceKey = options.voiceKey ?? ((scope) => `flow-voice:voice:${scope}`);
    const dictationKey = options.dictationKey ?? ((scope) => `flow-voice:dictation:${scope}`);
    const storage = () => {
        if (options.storage !== undefined)
            return options.storage;
        try {
            return globalThis.localStorage ?? null;
        }
        catch {
            return null;
        }
    };
    const voices = new Map();
    const dictations = new Map();
    const listeners = new Set();
    const notify = () => listeners.forEach((listener) => listener());
    const read = (key) => {
        try {
            return storage()?.getItem(key) ?? null;
        }
        catch {
            return null;
        }
    };
    const write = (key, value) => {
        try {
            if (value === null)
                storage()?.removeItem(key);
            else
                storage()?.setItem(key, value);
        }
        catch { /* The choice still applies for this page's lifetime. */ }
    };
    const preferences = {
        voice(scope) {
            if (!voices.has(scope))
                voices.set(scope, read(voiceKey(scope)) ?? '');
            return voices.get(scope) || undefined;
        },
        setVoice(scope, voice) {
            voices.set(scope, voice);
            write(voiceKey(scope), voice || null);
            notify();
        },
        dictation(scope) {
            let cached = dictations.get(scope);
            if (!cached) {
                let stored = null;
                try {
                    stored = JSON.parse(read(dictationKey(scope)) ?? 'null');
                }
                catch { /* Stale data: the defaults apply. */ }
                cached = stored ? normalizeDictationPreference(stored) : { ...DEFAULT_DICTATION_PREFERENCE };
                dictations.set(scope, cached);
            }
            return cached;
        },
        setDictation(scope, patch) {
            const next = normalizeDictationPreference({ ...preferences.dictation(scope), ...patch });
            dictations.set(scope, next);
            write(dictationKey(scope), JSON.stringify(next));
            notify();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return preferences;
}
//# sourceMappingURL=preferences.js.map