const messages = {
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
export function speechError(code) {
    return Object.assign(new Error(messages[code]), {
        code,
        retryable: ['rate_limited', 'timeout', 'transport_error', 'provider_error'].includes(code),
    });
}
export function normalizeSpeechError(error) {
    const value = error;
    const code = value?.name === 'AbortError'
        ? 'cancelled'
        : value?.name === 'TimeoutError'
            ? 'timeout'
            : value?.status === 401 || value?.status === 403
                ? 'unauthorized'
                : value?.status === 429
                    ? 'rate_limited'
                    : value?.code && Object.hasOwn(messages, value.code)
                        ? value.code
                        : 'provider_error';
    const safe = speechError(code);
    return {
        code,
        message: safe.message,
        retryable: value?.code === code && typeof value.retryable === 'boolean'
            ? value.retryable
            : safe.retryable,
    };
}
//# sourceMappingURL=errors.js.map