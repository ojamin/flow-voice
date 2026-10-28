import { expect, it } from 'vitest';
import { normalizeSpeechError } from './errors.js';
import { nativeError } from './transport.js';

it('preserves native adapter error codes and retryability without upstream details', () => {
  for (const code of ['provider_error', 'rate_limited', 'cancelled'] as const) {
    const error = nativeError(code);
    error.message = 'secret upstream response';
    const normalized = normalizeSpeechError(error);
    expect(normalized).toMatchObject({ code, retryable: error.retryable });
    expect(normalized.message).not.toContain('secret');
  }
});

it('does not accept retryability from an unknown error code', () => {
  expect(normalizeSpeechError({ code: 'unknown', retryable: false })).toMatchObject({
    code: 'provider_error',
    retryable: true,
  });
});
