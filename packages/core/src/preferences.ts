/** A user's dictation choices. Hosts store them (per user, device or environment). */
export interface DictationPreference {
  /** Send after a pause in speech, with a countdown that can be cancelled. */
  sendAfterPause: boolean;
  silenceMs: number;
  /** Send when the transcript ends with `keyword`, which is removed. */
  sendOnWord: boolean;
  keyword: string;
  /** Leave the microphone off after a message is sent instead of listening for the next. */
  stopAfterSend: boolean;
}

export const SILENCE_MS = { default: 1500, min: 300, max: 60_000 } as const;

export const DEFAULT_DICTATION_PREFERENCE: Readonly<DictationPreference> = Object.freeze({
  sendAfterPause: false,
  silenceMs: SILENCE_MS.default,
  sendOnWord: false,
  keyword: '',
  stopAfterSend: false,
});

/** Accepts stored or partial input and returns a complete, valid preference. An older
 * `enabled` flag (one switch for both sends) migrates to both sends when they are unset. */
export function normalizeDictationPreference(value: unknown): DictationPreference {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const legacy = input.enabled === true;
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  const silenceMs = typeof input.silenceMs === 'number' && Number.isFinite(input.silenceMs)
    ? Math.round(Math.min(SILENCE_MS.max, Math.max(SILENCE_MS.min, input.silenceMs)))
    : SILENCE_MS.default;
  return {
    sendAfterPause: typeof input.sendAfterPause === 'boolean' ? input.sendAfterPause : legacy,
    silenceMs,
    sendOnWord: typeof input.sendOnWord === 'boolean' ? input.sendOnWord : legacy && keyword !== '',
    keyword,
    stopAfterSend: input.stopAfterSend === true,
  };
}

export interface AutoSendSettings {
  enabled: boolean;
  silenceMs: number;
  keyword: string;
  afterPause: boolean;
}

/** The dictation controller's `autoSend` for a preference. On a call, a pause sends when the
 * user chose neither send, so a hands-free conversation always sends on its own. */
export function autoSendFor(
  preference: DictationPreference,
  { onCall = false }: { onCall?: boolean } = {},
): AutoSendSettings {
  const word = preference.sendOnWord && preference.keyword !== '';
  const afterPause = preference.sendAfterPause || (onCall && !word);
  return {
    enabled: afterPause || word,
    silenceMs: preference.silenceMs,
    keyword: word ? preference.keyword : '',
    afterPause,
  };
}
