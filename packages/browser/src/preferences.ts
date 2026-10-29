import { DEFAULT_DICTATION_PREFERENCE, normalizeDictationPreference } from '@flow-voice/core';
import type { DictationPreference } from '@flow-voice/core';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A user's speech choices per scope (a host's environment, workspace or account). */
export interface SpeechPreferences {
  /** The chosen voice id, or undefined for the provider's default. */
  voice(scope: string): string | undefined;
  /** An empty id goes back to the provider's default. */
  setVoice(scope: string, voice: string): void;
  dictation(scope: string): DictationPreference;
  setDictation(scope: string, patch: Partial<DictationPreference>): void;
  subscribe(listener: () => void): () => void;
}

export interface SpeechPreferencesOptions {
  /** Defaults to localStorage; null keeps choices for the page's lifetime only. */
  storage?: PreferenceStorage | null;
  voiceKey?(scope: string): string;
  dictationKey?(scope: string): string;
}

/** Persisted speech choices. Storage that is unavailable or holds stale data never throws:
 * choices then last for the page's lifetime and the defaults apply. */
export function createSpeechPreferences(options: SpeechPreferencesOptions = {}): SpeechPreferences {
  const voiceKey = options.voiceKey ?? ((scope) => `flow-voice:voice:${scope}`);
  const dictationKey = options.dictationKey ?? ((scope) => `flow-voice:dictation:${scope}`);
  const storage = (): PreferenceStorage | null => {
    if (options.storage !== undefined) return options.storage;
    try { return globalThis.localStorage ?? null; }
    catch { return null; }
  };
  const voices = new Map<string, string>();
  const dictations = new Map<string, DictationPreference>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const read = (key: string) => {
    try { return storage()?.getItem(key) ?? null; }
    catch { return null; }
  };
  const write = (key: string, value: string | null) => {
    try {
      if (value === null) storage()?.removeItem(key);
      else storage()?.setItem(key, value);
    } catch { /* The choice still applies for this page's lifetime. */ }
  };
  const preferences: SpeechPreferences = {
    voice(scope) {
      if (!voices.has(scope)) voices.set(scope, read(voiceKey(scope)) ?? '');
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
        let stored: unknown = null;
        try { stored = JSON.parse(read(dictationKey(scope)) ?? 'null'); }
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
