import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSpeechPlayer } from '../index.js';
import type { SpeechPlayer } from '../index.js';
import type { SynthesisAudio } from '@flow-voice/core';
const tick = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};
const media: FakeAudio[] = [];
let denyPlay = false;
class FakeAudio {
  src = '';
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {
    if (denyPlay) throw new DOMException('gesture', 'NotAllowedError');
  });
  pause = vi.fn();
  load = vi.fn();
  constructor() {
    media.push(this);
  }
  removeAttribute() {
    this.src = '';
  }
}
function audio(): SynthesisAudio {
  return {
    format: { kind: 'encoded', mimeType: 'audio/mpeg' },
    mimeType: 'audio/mpeg',
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1, 2]));
        c.close();
      },
    }),
  };
}
let player: SpeechPlayer;
beforeEach(() => {
  media.length = 0;
  denyPlay = false;
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('MediaSource', undefined);
});
afterEach(() => {
  player?.dispose();
  vi.unstubAllGlobals();
});
it('reuses one audio element, pauses/resumes and clears the blob URL on stop', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  player = createSpeechPlayer({ synthesize: async () => audio() });
  player.enqueue({
    id: 'one',
    sections: [
      { ordinal: 0, text: 'one' },
      { ordinal: 1, text: 'two' },
    ],
  });
  await tick();
  expect(media).toHaveLength(1);
  expect(media[0]!.play).toHaveBeenCalledOnce();
  player.pause();
  expect(media[0]!.pause).toHaveBeenCalled();
  await player.resume();
  expect(media[0]!.play).toHaveBeenCalledTimes(2);
  media[0]!.onended?.();
  await tick();
  expect(media).toHaveLength(1);
  expect(media[0]!.play).toHaveBeenCalledTimes(3);
  player.stop();
  await tick();
  expect(media[0]!.src).toBe('');
  expect(revoke).toHaveBeenCalledTimes(2);
  revoke.mockRestore();
});
it('exposes encoded autoplay refusal without playing late clips after stop', async () => {
  denyPlay = true;
  player = createSpeechPlayer({ synthesize: async () => audio() });
  player.enqueue({ id: 'one', sections: [{ ordinal: 0, text: 'one' }] });
  await tick();
  expect(player.getSnapshot().status).toBe('blocked');
  player.stop();
  await tick();
  expect(player.getSnapshot().status).toBe('idle');
});
it('streams supported encoded formats through MediaSource before response end', async () => {
  class Buffer extends EventTarget {
    buffered = { length: 0, start: () => 0 };
    appendBuffer = vi.fn(() => {
      queueMicrotask(() => this.dispatchEvent(new Event('updateend')));
    });
    remove() {}
  }
  const buffer = new Buffer();
  class Source extends EventTarget {
    static isTypeSupported() {
      return true;
    }
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('sourceopen')));
    }
    addSourceBuffer() {
      return buffer;
    }
    endOfStream = vi.fn();
  }
  vi.stubGlobal('MediaSource', Source);
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const value = audio();
  value.stream = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue(new Uint8Array([1, 2]));
    },
  });
  player = createSpeechPlayer({ synthesize: async () => value });
  player.enqueue({ id: 'one', sections: [{ ordinal: 0, text: 'one' }] });
  await tick();
  expect(buffer.appendBuffer).toHaveBeenCalledOnce();
  expect(media[0]!.play).toHaveBeenCalledOnce();
  controller.close();
  await tick();
  media[0]!.onended?.();
  await tick();
  expect(player.getSnapshot().status).toBe('idle');
  create.mockRestore();
});
