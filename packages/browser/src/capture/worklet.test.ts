import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('standalone asset downmixes channels and transfers mono buffers without echoing audio', () => {
  let Processor!: new () => { process(inputs: Float32Array[][]): boolean };
  const frames: Float32Array[] = [];
  runInNewContext(readFileSync(new URL('./worklet.js', import.meta.url), 'utf8'), {
    Float32Array,
    AudioWorkletProcessor: class {
      port = { postMessage: (data: Float32Array) => frames.push(data) };
    },
    registerProcessor(name: string, value: typeof Processor) {
      expect(name).toBe('flow-voice-capture');
      Processor = value;
    },
  });
  const processor = new Processor();
  expect(processor.process([[new Float32Array([0.6, 0.2]), new Float32Array([0.2, -0.2])]])).toBe(
    true,
  );
  expect(frames[0][0]).toBeCloseTo(0.4);
  expect(frames[0][1]).toBeCloseTo(0);
  expect(processor.process([])).toBe(true);
  expect(frames).toHaveLength(1);
});
