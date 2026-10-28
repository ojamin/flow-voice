import type { SpeechError, SpeechErrorCode } from '@flow-voice/core';

const messages: Record<SpeechErrorCode, string> = {
  invalid_message: 'Invalid speech request.',
  not_configured: 'Speech is not configured.',
  unsupported: 'Speech operation is not supported.',
  unauthorized: 'Speech provider authentication failed.',
  rate_limited: 'Speech provider rate limit reached.',
  limit_exceeded: 'Speech limit exceeded.',
  provider_error: 'Speech provider failed.',
  timeout: 'Speech operation timed out.',
  cancelled: 'Speech operation cancelled.',
  transport_error: 'Speech transport failed.',
};
/** Only stable codes cross the trust boundary; never copy upstream messages, bodies or URLs. */
export function speechError(code: SpeechErrorCode): Error & SpeechError & { retryable: boolean } {
  return Object.assign(new Error(messages[code]), {
    code,
    retryable: ['rate_limited', 'timeout', 'transport_error', 'provider_error'].includes(code),
  });
}
export function normalizeSpeechError(error: unknown): SpeechError & { retryable: boolean } {
  const value = error as {
    code?: string;
    name?: string;
    status?: number;
    retryable?: boolean;
  } | null;
  const code: SpeechErrorCode =
    value?.name === 'AbortError'
      ? 'cancelled'
      : value?.name === 'TimeoutError'
        ? 'timeout'
        : value?.status === 401 || value?.status === 403
          ? 'unauthorized'
          : value?.status === 429
            ? 'rate_limited'
            : value?.code && Object.hasOwn(messages, value.code)
              ? (value.code as SpeechErrorCode)
              : 'provider_error';
  const safe = speechError(code);
  return {
    code,
    message: safe.message,
    retryable:
      value?.code === code && typeof value.retryable === 'boolean'
        ? value.retryable
        : safe.retryable,
  };
}
