/** Known endpoint families; capability discovery belongs to the adapter, not this list. */
export const PROVIDER_IDS = [
    'openai',
    'elevenlabs',
    'cartesia',
    'xai',
    'azure',
    'google',
    'deepgram',
    'groq',
    'assemblyai',
    'mistral',
    'moss-compat',
    'speechmatics',
    'gladia',
    'rev.ai',
    'fake',
];
export const DEFAULT_LIMITS = {
    maxSessionMs: 300_000,
    maxTextChars: 4_000,
    maxFrameBytes: 32_000,
    maxBufferedAudioBytes: 320_000,
    finalizationMs: 10_000,
    maxQueuedSections: 32,
};
//# sourceMappingURL=provider.js.map