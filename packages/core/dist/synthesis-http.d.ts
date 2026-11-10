/** Shared wire headers for streaming synthesis over HTTP. */
export declare const SYNTHESIS_HEADERS: {
    readonly contentType: 'Content-Type';
    readonly cacheControl: 'Cache-Control';
    readonly sampleRate: 'X-Audio-Sample-Rate';
    readonly channels: 'X-Audio-Channels';
    readonly encoding: 'X-Audio-Encoding';
};
