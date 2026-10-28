import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter, TtsAdapter } from './index.js';
import { speechError } from './errors.js';
import { nativeProviderFactories } from './providers/registry.js';

type Factory = (config: ProviderEndpointConfig) => { stt?: SttAdapter; tts?: TtsAdapter };
const providers: Record<string, Factory> = nativeProviderFactories;
export function createAdapters(config: ProviderEndpointConfig): {
  stt?: SttAdapter;
  tts?: TtsAdapter;
} {
  const factory = Object.hasOwn(providers, config.provider)
    ? providers[config.provider]
    : undefined;
  if (!factory) throw speechError('unsupported');
  if (config.baseUrl) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw speechError('invalid_message');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw speechError('invalid_message');
  }
  return factory(config);
}
