import { describe, expect, it } from 'vitest';
import { PcmResampler } from './resampler.js';

function resample(frequency: number, rate = 16000) {
  const resampler = new PcmResampler(48000, rate);
  const frames: { audio: Uint8Array; rms: number }[] = [];
  for (let offset = 0; offset < 48000; offset += 128) {
    frames.push(
      ...resampler.push(
        Float32Array.from(
          { length: Math.min(128, 48000 - offset) },
          (_, index) => Math.sin((2 * Math.PI * frequency * (offset + index)) / 48000) * 0.5,
        ),
      ),
    );
  }
  frames.push(...resampler.flush());
  return frames;
}
describe('PCM resampler', () => {
  it.each([16000, 24000])(
    'emits %iHz little endian PCM in ~80ms frames with accurate RMS',
    (rate) => {
      const frames = resample(1000, rate);
      expect(frames.slice(0, -1).every((frame) => frame.audio.byteLength === rate * 0.08 * 2)).toBe(
        true,
      );
      expect(
        Math.abs(frames.reduce((sum, frame) => sum + frame.audio.byteLength / 2, 0) - rate),
      ).toBeLessThanOrEqual(1);
      expect(frames[2].rms).toBeCloseTo(Math.sqrt(0.125), 2);
      const view = new DataView(frames[1].audio.buffer);
      expect(Math.abs(view.getInt16(2, true))).toBeGreaterThan(1000);
    },
  );
  it('rejects above-Nyquist energy rather than aliasing it into speech', () => {
    const frames = resample(12000);
    expect(frames[2].rms).toBeLessThan(0.005);
  });
  it('is invariant to chunk boundaries', () => {
    const input = Float32Array.from({ length: 48000 }, (_, index) => Math.sin(index / 10));
    const whole = new PcmResampler(48000, 16000);
    const split = new PcmResampler(48000, 16000);
    const a = [...whole.push(input), ...whole.flush()].flatMap((frame) => [...frame.audio]);
    const chunks = [];
    for (let i = 0; i < input.length; i += 127) chunks.push(...split.push(input.slice(i, i + 127)));
    chunks.push(...split.flush());
    expect(chunks.flatMap((frame) => [...frame.audio])).toEqual(a);
  });
});
