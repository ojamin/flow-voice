import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoReader, createPlaybackGate, createSpeechPlayer } from '../index.js';
import type { MessageAdapter, MessageArrival, SpeechPlayer, SynthesisFetcher } from '../index.js';
import type { SynthesisAudio } from '@flow-voice/core';

const sources: FakeSource[] = [];
const samples: Float32Array[] = [];
let blocked = false;
class FakeSource {
  buffer: unknown;
  onended: (() => void) | null = null;
  stopped = false;
  target: unknown;
  connect(target: unknown) {
    this.target = target;
  }
  disconnect() {}
  start() {
    sources.push(this);
  }
  stop() {
    this.stopped = true;
  }
  end() {
    this.onended?.();
  }
}
class FakeContext {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  async resume() {
    if (blocked) throw new DOMException('gesture', 'NotAllowedError');
    this.state = 'running';
  }
  async suspend() {
    this.state = 'suspended';
  }
  async close() {
    this.state = 'closed';
  }
  createBuffer(channels: number, frames: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(frames));
    return {
      getChannelData: (channel: number) => {
        const array = data[channel]!;
        samples.push(array);
        return array;
      },
    };
  }
  createBufferSource() {
    return new FakeSource();
  }
  createMediaStreamDestination() {
    return { stream: { id: 'background' } };
  }
}
class FakeMedia {
  static played: FakeMedia[] = [];
  srcObject: unknown = null;
  paused = true;
  async play() {
    this.paused = false;
    FakeMedia.played.push(this);
  }
  pause() {
    this.paused = true;
  }
}
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function pcm(bytes = [0, 64, 0, 32]): SynthesisAudio {
  return {
    format: { kind: 'pcm', encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 },
    mimeType: 'audio/pcm',
    stream: new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(bytes.slice(0, 1)));
        c.enqueue(new Uint8Array(bytes.slice(1)));
        c.close();
      },
    }),
  };
}
const message = (id: string, ...texts: string[]) => ({
  id,
  sections: texts.map((text, ordinal) => ({ text, ordinal })),
});
const players: SpeechPlayer[] = [];
function player(synthesize: SynthesisFetcher = async () => pcm(), extra = {}) {
  const p = createSpeechPlayer({ synthesize, ...extra });
  players.push(p);
  return p;
}
beforeEach(() => {
  sources.length = 0;
  samples.length = 0;
  blocked = false;
  vi.stubGlobal('AudioContext', FakeContext);
});
afterEach(() => {
  players.forEach((p) => p.dispose());
  players.length = 0;
  vi.unstubAllGlobals();
});

describe('speech player', () => {
  it('times out stalled synthesis admission and stream reads with announced errors', async () => {
    vi.useFakeTimers();
    try {
      const stalled = player(async () => new Promise<SynthesisAudio>(() => {}));
      stalled.enqueue(message('stalled', 'a'));
      await tick();
      await vi.advanceTimersByTimeAsync(30000);
      expect(stalled.getSnapshot().error?.code).toBe('timeout');
      const audio = pcm();
      audio.stream = new ReadableStream();
      const stream = player(async () => audio);
      stream.enqueue(message('stream', 'a'));
      await tick();
      await vi.advanceTimersByTimeAsync(30000);
      expect(stream.getSnapshot().error?.code).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });
  it('stops on pagehide and removes its lifecycle listener on dispose', async () => {
    const target = new EventTarget();
    vi.stubGlobal('addEventListener', target.addEventListener.bind(target));
    vi.stubGlobal('removeEventListener', target.removeEventListener.bind(target));
    const p = player();
    p.enqueue(message('page', 'a'));
    await tick();
    target.dispatchEvent(new Event('pagehide'));
    expect(p.getSnapshot().status).toBe('idle');
    expect(sources[0]!.stopped).toBe(true);
    p.dispose();
  });
  it('bounds scheduled PCM to two 125ms windows even for a large chunk', async () => {
    const value = pcm();
    value.stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(48000));
        c.close();
      },
    });
    const p = player(async () => value);
    p.enqueue(message('large', 'a'));
    await tick();
    expect(sources).toHaveLength(2);
    p.stop();
  });
  it('keeps live ownership across a drained section until completion or Stop', async () => {
    const fetcher = vi.fn<SynthesisFetcher>(async () => pcm());
    const p = player(fetcher);
    const a = adapter();
    const reader = createAutoReader({ player: p, messages: a.messages, enabled: true });
    a.emit('stream-gap', '<tts>one</tts>', false);
    await tick();
    sources[0]!.end();
    await tick();
    expect(p.getSnapshot().status).toBe('idle');
    p.stop();
    a.emit('stream-gap', '<tts>one</tts><tts>two</tts>', true);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    p.enqueue(message('stream-gap', 'one', 'two'));
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(3);
    reader.dispose();
  });
  it('does not narrate later streaming sections of a stopped message', async () => {
    const p = player();
    p.append(message('stream', 'a'));
    await tick();
    p.stop();
    p.append({ id: 'stream', sections: [{ ordinal: 1, text: 'late' }] });
    await tick();
    expect(sources).toHaveLength(1);
    p.enqueue(message('stream', 'a'));
    await tick();
    expect(sources).toHaveLength(2);
  });
  it('interrupts a pending host beforePlay hook without blocking subsequent playback', async () => {
    let held = true;
    const p = player(undefined, {
      beforePlay: () => (held ? new Promise<void>(() => {}) : undefined),
    });
    p.enqueue(message('old', 'a'));
    await tick();
    p.stop();
    held = false;
    p.enqueue(message('new', 'b'));
    await tick();
    expect(p.getSnapshot().messageId).toBe('new');
  });
  it('orders sections, preserves split samples, and fetches only one ahead', async () => {
    const fetcher = vi.fn<SynthesisFetcher>(async () => pcm());
    const p = player(fetcher);
    p.enqueue(message('one', 'a', 'b', 'c'));
    await tick();
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(sources).toHaveLength(1);
    expect(Array.from(samples[0]!)).toEqual([0.5, 0.25]);
    sources[0]!.end();
    await tick();
    expect(fetcher.mock.calls).toHaveLength(3);
    expect(sources).toHaveLength(2);
    sources[1]!.end();
    await tick();
    sources[2]!.end();
    await tick();
    expect(p.getSnapshot().status).toBe('idle');
  });
  it('pauses/resumes, skips one section and ends only the current message', async () => {
    const fetcher = vi.fn<SynthesisFetcher>(async () => pcm());
    const p = player(fetcher);
    p.enqueue(message('one', 'a', 'b', 'c'));
    p.enqueue(message('two', 'd'));
    await tick();
    p.pause();
    expect(p.getSnapshot().status).toBe('paused');
    await p.resume();
    expect(p.getSnapshot().status).toBe('playing');
    p.skipSection();
    await tick();
    expect(sources[0]!.stopped).toBe(true);
    expect(p.getSnapshot().sectionOrdinal).toBe(1);
    p.skipToEnd();
    await tick();
    expect(p.getSnapshot().messageId).toBe('two');
    p.stop();
    expect(p.getSnapshot().status).toBe('idle');
    expect(p.getSnapshot().queuedMessages).toBe(0);
  });
  it('fences late fetches without blocking a subsequent queue', async () => {
    let resolve!: (value: SynthesisAudio) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SynthesisAudio>((r) => {
            resolve = r;
          }),
      )
      .mockImplementation(async () => pcm());
    const p = player(fetcher);
    p.enqueue(message('old', 'a'));
    await tick();
    p.stop();
    p.enqueue(message('new', 'b'));
    await tick();
    expect(p.getSnapshot().messageId).toBe('new');
    resolve(pcm());
    await tick();
    expect(sources).toHaveLength(1);
  });
  it('cancels late stream chunks and disposes idempotently', async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    const audio = pcm();
    audio.stream = new ReadableStream({
      start(c) {
        stream = c;
      },
    });
    const p = player(async () => audio);
    p.enqueue(message('one', 'a'));
    await tick();
    p.stop();
    await tick();
    expect(() => stream.enqueue(new Uint8Array([0, 0]))).toThrow();
    expect(sources).toHaveLength(0);
    p.dispose();
    p.dispose();
    p.enqueue(message('two', 'b'));
    await tick();
    expect(p.getSnapshot().status).toBe('idle');
  });
  it('retains the current section when autoplay is blocked and unlocks it', async () => {
    blocked = true;
    const p = player();
    p.enqueue(message('one', 'a'));
    await tick();
    expect(p.getSnapshot().status).toBe('blocked');
    blocked = false;
    await p.unlock();
    await tick();
    expect(p.getSnapshot().status).toBe('playing');
    expect(sources).toHaveLength(1);
  });
  it('stops synchronously on mic acquisition and rejects playback while held', async () => {
    const gate = createPlaybackGate();
    const p = player(undefined, { gate });
    p.enqueue(message('one', 'a'));
    await tick();
    const release = gate.acquireMicrophone();
    expect(sources[0]!.stopped).toBe(true);
    p.enqueue(message('two', 'b'));
    await tick();
    expect(p.getSnapshot().queuedMessages).toBe(0);
    release();
    release();
    p.enqueue(message('three', 'c'));
    await tick();
    expect(p.getSnapshot().messageId).toBe('three');
  });
  it('plays through one running media element in background mode, and back to the speakers', async () => {
    vi.stubGlobal('Audio', FakeMedia);
    FakeMedia.played = [];
    const p = player();
    await p.setBackgroundAudio(true);
    const media = FakeMedia.played[0]!;
    expect(media.paused).toBe(false);
    expect(media.srcObject).toEqual({ id: 'background' });
    p.enqueue(message('one', 'a'));
    await tick();
    expect(sources[0]!.target).toEqual({ stream: { id: 'background' } });
    sources[0]!.end();
    await tick();
    // Silence between replies keeps the element playing.
    expect(media.paused).toBe(false);
    await p.setBackgroundAudio(false);
    expect(media.paused).toBe(true);
    p.enqueue(message('two', 'b'));
    await tick();
    expect(sources.at(-1)!.target).toEqual({});
  });
  it('queues a whole long reply by default', () => {
    const p = player();
    const texts = Array.from({ length: 500 }, (_, index) => `Sentence ${index}.`);
    p.enqueue(message('long', ...texts));
    expect(p.getSnapshot().error).toBeNull();
    expect(p.getSnapshot().queuedMessages).toBe(1);
  });
  it('bounds queue admission when the host sets a limit, and permits manual rereading', async () => {
    const p = player(undefined, { maxQueuedSections: 1 });
    p.enqueue(message('one', 'a'));
    p.enqueue(message('two', 'b'));
    expect(p.getSnapshot().error?.code).toBe('limit_exceeded');
    await tick();
    sources[0]!.end();
    await tick();
    p.enqueue(message('one', 'a'));
    await tick();
    expect(sources).toHaveLength(2);
  });
});

function adapter() {
  const listeners = new Set<(arrival: MessageArrival) => void>();
  const history = [{ id: 'history', markdown: 'old', own: false, complete: true }];
  const messages: MessageAdapter = {
    getSnapshot: () => history,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
  return {
    messages,
    emit(
      id: string,
      markdown: string,
      complete = true,
      source: MessageArrival['source'] = 'live',
      own = false,
    ) {
      listeners.forEach((fn) => fn({ source, message: { id, markdown, complete, own } }));
    },
  };
}
describe('auto-reader', () => {
  it('ignores history, replays, own and muted messages; dedupes two subscribers', async () => {
    const a = adapter();
    const fetcher = vi.fn<SynthesisFetcher>(async () => pcm());
    const p = player(fetcher);
    const one = createAutoReader({ player: p, messages: a.messages, enabled: true });
    const two = createAutoReader({ player: p, messages: a.messages, enabled: true });
    a.emit('history', 'old');
    a.emit('replay', 'no', true, 'replay');
    a.emit('own', 'no', true, 'live', true);
    a.emit('future', 'hello');
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    sources[0]!.end();
    await tick();
    a.emit('future', 'hello');
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    one.dispose();
    two.dispose();
  });
  it('extracts closed append-only streaming tags and stops on navigation/malformed growth', async () => {
    const a = adapter();
    const fetcher = vi.fn<SynthesisFetcher>(async () => pcm());
    const p = player(fetcher);
    const reader = createAutoReader({
      player: p,
      messages: a.messages,
      enabled: false,
      routeIdentity: 'a',
    });
    a.emit('disabled', 'no');
    reader.setEnabled(true);
    a.emit('future', '<tts>one</tts>', false);
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    a.emit('future', '<tts>one</tts><tts>two</tts>', false);
    await tick();
    sources[0]!.end();
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(2);
    reader.setRouteIdentity('b');
    expect(p.getSnapshot().status).toBe('idle');
    a.emit('bad', '<tts>valid</tts>', false);
    await tick();
    a.emit('bad', '<tts>changed</tts>', false);
    expect(p.getSnapshot().status).toBe('idle');
    reader.dispose();
  });
  it('disposes prior-route watermarks and rejections across repeated history cycles', () => {
    const a = adapter();
    const append = vi.fn();
    const p = { append, stop: vi.fn() } as unknown as SpeechPlayer;
    const reader = createAutoReader({ player: p, messages: a.messages, enabled: true });
    for (let route = 0; route < 2100; route++) {
      reader.setRouteIdentity(route);
      a.emit('history', 'never replay');
      a.emit('route-id', 'history', true, 'history');
      a.emit('route-id', 'not live');
      a.emit('rejected', 'own', true, 'live', true);
      reader.setRouteIdentity(`${route}-next`);
      a.emit('route-id', 'new live');
      a.emit('rejected', 'new live');
    }
    expect(append).toHaveBeenCalledTimes(4200);
    reader.dispose();
  });
  it('resolves host filters and voice preferences at arrival', async () => {
    const a = adapter();
    const fetcher = vi.fn<SynthesisFetcher>(async () => pcm());
    const p = player(fetcher);
    let muted = true;
    const reader = createAutoReader({
      player: p,
      messages: a.messages,
      enabled: true,
      filter: (m) => m.id !== 'filtered',
      preferences: () => ({ muted, voice: 'agent', speed: 1.2 }),
    });
    a.emit('muted', 'no');
    muted = false;
    a.emit('filtered', 'no');
    a.emit('yes', 'yes');
    await tick();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toMatchObject({ voice: 'agent', speed: 1.2 });
    reader.dispose();
  });
});
