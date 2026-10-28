// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createAudioCapture } from './capture.js';

const stops = vi.fn();
const close = vi.fn(async () => {});
const disconnect = vi.fn();
let node: {
  port: { onmessage: ((event: { data: Float32Array }) => void) | null };
  onprocessorerror?: () => void;
};
function setup(
  getUserMedia: () => Promise<{ getTracks(): { stop(): void }[] }> = vi.fn(async () => ({
    getTracks: () => [{ stop: stops }],
  })),
) {
  vi.stubGlobal('isSecureContext', true);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  const addModule = vi.fn(async () => {});
  vi.stubGlobal(
    'AudioContext',
    class {
      sampleRate = 48000;
      audioWorklet = { addModule };
      destination = {};
      createMediaStreamSource() {
        return { connect: vi.fn(), disconnect };
      }
      resume = vi.fn(async () => {});
      close = close;
    },
  );
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null };
      connect = vi.fn();
      disconnect = disconnect;
      constructor() {
        node = { port: this.port };
      }
    },
  );
  const abort = new AbortController();
  const onFrame = vi.fn();
  const onError = vi.fn();
  const capture = createAudioCapture({
    format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    signal: abort.signal,
    onFrame,
    onError,
    workletUrl: '/assets/voice-worklet.js',
  });
  return { capture, abort, onFrame, onError, getUserMedia, addModule };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('requests mono enhanced microphone audio, loads same-origin worklet, frames PCM, and releases tracks on pagehide', async () => {
  const f = setup();
  await f.capture.start();
  expect(f.getUserMedia).toHaveBeenCalledWith({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
    video: false,
  });
  expect(f.addModule).toHaveBeenCalledWith('/assets/voice-worklet.js');
  for (let i = 0; i < 32; i++) node.port.onmessage?.({ data: new Float32Array(128).fill(0.1) });
  expect(f.onFrame.mock.calls[0][0].byteLength).toBe(2560);
  expect(f.onFrame.mock.calls[0][1]).toBeCloseTo(0.1, 2);
  window.dispatchEvent(new Event('pagehide'));
  await f.capture.stop();
  expect(stops).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});
it.each([
  ['NotAllowedError', 'unauthorized'],
  ['NotFoundError', 'unsupported'],
] as const)('maps %s without exposing device diagnostics', async (name, code) => {
  const f = setup(
    vi.fn(async () => {
      throw new DOMException('private device information', name);
    }),
  );
  await expect(f.capture.start()).rejects.toMatchObject({ code });
  expect(f.onError.mock.calls[0][0].message).not.toContain('private');
});
it('refuses insecure contexts without asking for permission', async () => {
  const f = setup();
  vi.stubGlobal('isSecureContext', false);
  await expect(f.capture.start()).rejects.toMatchObject({ code: 'unsupported' });
  expect(f.getUserMedia).not.toHaveBeenCalled();
});
it('never tries Blob fallback without CSP opt-in', async () => {
  const f = setup();
  f.addModule.mockRejectedValueOnce(new Error('blocked asset'));
  await expect(f.capture.start()).rejects.toMatchObject({ code: 'provider_error' });
  expect(f.addModule).toHaveBeenCalledTimes(1);
  expect(stops).toHaveBeenCalledOnce();
});
it('revokes an explicitly CSP-permitted Blob fallback module URL', async () => {
  const f = setup();
  f.addModule.mockRejectedValueOnce(new Error('asset unavailable'));
  const createObjectURL = vi.fn(() => 'blob:flow-voice-test');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    },
  );
  const capture = createAudioCapture({
    format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    signal: f.abort.signal,
    onFrame: f.onFrame,
    onError: f.onError,
    inlineWorklet: { source: '/* worklet module */', cspAllowsBlob: true },
  });
  await capture.start();
  expect(createObjectURL).toHaveBeenCalledOnce();
  expect(f.addModule).toHaveBeenLastCalledWith('blob:flow-voice-test');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:flow-voice-test');
  await capture.stop();
});
it('releases permission-result tracks when cancelled during the permission prompt', async () => {
  let resolve!: (stream: { getTracks(): { stop(): void }[] }) => void;
  const f = setup(
    vi.fn(
      () =>
        new Promise<{ getTracks(): { stop(): void }[] }>((done) => {
          resolve = done;
        }),
    ),
  );
  const started = f.capture.start();
  f.abort.abort();
  resolve({ getTracks: () => [{ stop: stops }] });
  await started;
  expect(stops).toHaveBeenCalledTimes(1);
  expect(f.addModule).not.toHaveBeenCalled();
});
