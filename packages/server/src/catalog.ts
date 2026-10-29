import type { Voice } from '@flow-voice/core';
import type { TtsAdapter } from './index.js';
import { listVoices } from './synthesis.js';

/** A short-lived voice list per endpoint, so synthesis does not ask the provider every time. */
export interface VoiceCatalog {
  /** The provider's list now (for a settings screen); also refreshes the cache. */
  refresh(endpoint: string, adapter: TtsAdapter, signal: AbortSignal): Promise<readonly Voice[]>;
  /** The cached list while it is fresh, otherwise the provider's list. */
  get(endpoint: string, adapter: TtsAdapter, signal: AbortSignal): Promise<readonly Voice[]>;
}

const MAX_ENDPOINTS = 32;

/** `endpoint` identifies the provider configuration (for example its base URL and key
 * fingerprint); a changed configuration must use a new endpoint key. */
export function createVoiceCatalog(options: { ttlMs?: number; now?(): number } = {}): VoiceCatalog {
  const ttlMs = options.ttlMs ?? 60_000;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { voices: readonly Voice[]; expires: number }>();
  const catalog: VoiceCatalog = {
    async refresh(endpoint, adapter, signal) {
      const voices = await listVoices({ adapter, signal });
      cache.delete(endpoint);
      cache.set(endpoint, { voices, expires: now() + ttlMs });
      if (cache.size > MAX_ENDPOINTS) cache.delete(cache.keys().next().value!);
      return voices;
    },
    async get(endpoint, adapter, signal) {
      const cached = cache.get(endpoint);
      return cached && cached.expires > now() ? cached.voices : catalog.refresh(endpoint, adapter, signal);
    },
  };
  return catalog;
}
