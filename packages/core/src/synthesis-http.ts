/** Shared wire headers for streaming synthesis over HTTP. */
export const SYNTHESIS_HEADERS = {
  contentType: 'Content-Type',
  cacheControl: 'Cache-Control',
  sampleRate: 'X-Audio-Sample-Rate',
  channels: 'X-Audio-Channels',
  encoding: 'X-Audio-Encoding',
} as const;
