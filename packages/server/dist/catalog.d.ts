import type { Voice } from '@flow-voice/core';
import type { TtsAdapter } from './index.js';
/** A short-lived voice list per endpoint, so synthesis does not ask the provider every time. */
export interface VoiceCatalog {
    /** The provider's list now (for a settings screen); also refreshes the cache. */
    refresh(endpoint: string, adapter: TtsAdapter, signal: AbortSignal): Promise<readonly Voice[]>;
    /** The cached list while it is fresh, otherwise the provider's list. */
    get(endpoint: string, adapter: TtsAdapter, signal: AbortSignal): Promise<readonly Voice[]>;
}
/** `endpoint` identifies the provider configuration (for example its base URL and key
 * fingerprint); a changed configuration must use a new endpoint key. */
export declare function createVoiceCatalog(options?: {
    ttlMs?: number;
    now?(): number;
}): VoiceCatalog;
