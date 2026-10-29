import { expect, it } from 'vitest';
import { audioFormatFromHeaders } from './index.js';

const selected = { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } as const;
it.each<Record<string, string>>([{}, { 'content-type': 'audio/pcm' }, { 'content-type': 'audio/pcm;rate=22050' }])(
  'uses selected format for incomplete provider metadata: %j', (value) => {
    expect(audioFormatFromHeaders(new Headers(value), selected)).toEqual(selected);
  },
);
it('preserves selected codecs when the provider only reports the matching encoded media type', () => {
  const encoded = { kind: 'encoded', mimeType: 'audio/ogg; codecs=opus' } as const;
  expect(audioFormatFromHeaders(new Headers({ 'content-type': 'audio/ogg' }), encoded)).toEqual(encoded);
});
it.each<Record<string, string>>([
  { 'content-type': 'audio/pcm;rate=22050', 'x-audio-sample-rate': '24000' },
  { 'content-type': 'audio/pcm;channels=3' },
  { 'content-type': 'audio/pcm;encoding=pcm_f32le' },
  { 'content-type': 'audio/pcm;rate=NaN' },
  { 'content-type': 'audio/pcm;rate=22050;rate=22050' },
])('does not hide invalid or contradictory partial metadata with a fallback: %j', (value) => {
  expect(() => audioFormatFromHeaders(new Headers(value), selected)).toThrow(expect.objectContaining({ code: 'invalid_message' }));
});

const headers = { 'content-type': 'audio/pcm;rate=22050;channels=1', 'x-audio-encoding': 'pcm_s16le' };
it('accepts case, whitespace, quoted numeric parameters and equivalent declarations', () => {
  expect(audioFormatFromHeaders(new Headers({ 'content-type': 'Audio/PCM; RATE="22050"; CHANNELS="1"; encoding=PCM_S16LE', 'x-audio-sample-rate': '022050', 'x-audio-channels': '1' })))
    .toEqual({ kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 22050, channels: 1 });
});
it('preserves encoded MIME including codec parameters', () => {
  expect(audioFormatFromHeaders(new Headers({ 'content-type': 'audio/ogg; codecs="opus"' })))
    .toEqual({ kind: 'encoded', mimeType: 'audio/ogg; codecs="opus"' });
});
it.each<Record<string, string>>([
  {}, { 'content-type': 'audio/pcm' }, { 'content-type': 'audio/pcm;rate=22050;channels=1' },
  { 'content-type': 'audio/L16;rate=22050;channels=1' },
  { ...headers, 'x-audio-sample-rate': '48000' }, { ...headers, 'x-audio-channels': '2' },
  { ...headers, 'x-audio-encoding': 'pcm_f32le' },
  { ...headers, 'content-type': 'audio/pcm;rate=22050;rate=48000;channels=1' },
  { ...headers, 'content-type': 'audio/pcm;rate=NaN;channels=1' },
  { ...headers, 'content-type': 'audio/pcm;rate=22050;channels=3' },
  { ...headers, 'content-type': 'audio/pcm;rate=22050;channels=1;encoding=pcm_s16be' },
  { ...headers, 'content-type': 'audio/pcm;rate=22050;channels=1;bit_depth=32' },
  { ...headers, 'content-type': 'audio/mpeg' },
])('rejects missing, contradictory or ambiguous metadata: %j', (value) => {
  expect(() => audioFormatFromHeaders(new Headers(value))).toThrow(expect.objectContaining({ code: 'invalid_message' }));
});
