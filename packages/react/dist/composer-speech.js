import { useEffect, useRef, useState } from 'react';
import { supportedDictationRate } from '@flow-voice/browser';
/** Owns only the binding, never the session. Preferences are read at decision time, not captured. */
export function useComposerSpeech(options) {
    const { session, composer, owner, enabled = true, config, preferences, activityTarget } = options;
    const latest = useRef({ config, preferences });
    latest.current = { config, preferences };
    const rate = supportedDictationRate(config);
    const language = preferences.language ?? config.stt.defaults.language;
    const [binding, setBinding] = useState(null);
    useEffect(() => {
        if (!session || !composer || !enabled || !config.stt.enabled || rate === undefined) {
            setBinding(null);
            return;
        }
        const next = session.bindComposer(composer, {
            config: () => latest.current.config,
            preferences: () => latest.current.preferences,
            activityTarget,
        });
        setBinding(next);
        return () => next.dispose();
    }, [session, composer, owner, enabled, config.stt.enabled, config.tts.enabled, rate, language, activityTarget]);
    return { controller: binding?.dictation ?? null, call: binding?.call ?? null };
}
//# sourceMappingURL=composer-speech.js.map