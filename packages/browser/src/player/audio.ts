import type { SynthesisAudio } from '@flow-voice/core';
import { playEncoded } from './encoded.js';

export function abortError(): DOMException {
  return new DOMException('Playback cancelled', 'AbortError');
}
export function check(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? abortError();
}
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  check(signal);
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(signal.reason ?? abortError());
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}
/** Reads race cancellation even when a host stream ignores its abort signal. */
export async function read(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  check(signal);
  let cancel!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => {
      void reader.cancel().catch(() => {});
      reject(abortError());
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DOMException('Speech audio stream timed out', 'TimeoutError'));
      void reader.cancel().catch(() => {});
    }, 30000);
  });
  try {
    return await Promise.race([reader.read(), aborted, timeout]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

export interface AudioOutput {
  unlock(): Promise<void>;
  pause(): void;
  resume(): Promise<void>;
  play(audio: SynthesisAudio, signal: AbortSignal): Promise<void>;
  reset(): void;
  dispose(): void;
}
/** PCM buffers are scheduled at their native rate; AudioContext performs output-rate conversion.
 * Only 250ms is scheduled ahead. Encoded clips use one reusable audio element, bounded fallback.
 */
export function createAudioOutput(): AudioOutput {
  let context: AudioContext | undefined;
  let element: HTMLAudioElement | undefined;
  let paused = false;
  const ctx = () => (context ??= new AudioContext());
  return {
    async unlock() {
      // Invoke resume/play synchronously inside the host's gesture, before the first await.
      const resumed = ctx().resume();
      let primed: Promise<void> = Promise.resolve();
      if (element && !element.src) {
        const media = element;
        const wav = new Uint8Array(46);
        const view = new DataView(wav.buffer);
        wav.set([82, 73, 70, 70]);
        view.setUint32(4, 38, true);
        wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, 8000, true);
        view.setUint32(28, 16000, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        wav.set([100, 97, 116, 97], 36);
        view.setUint32(40, 2, true);
        const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
        media.src = url;
        primed = media.play().finally(() => {
          media.pause();
          media.removeAttribute('src');
          media.load();
          URL.revokeObjectURL(url);
        });
      }
      await Promise.all([resumed, primed]);
      if (ctx().state !== 'running')
        throw new DOMException('Audio requires a user gesture', 'NotAllowedError');
    },
    pause() {
      paused = true;
      if (context) void context.suspend();
      element?.pause();
    },
    async resume() {
      paused = false;
      if (context) await context.resume();
      if (element?.src) await element.play();
    },
    async play(audio, signal) {
      check(signal);
      if (audio.format.kind === 'encoded') {
        return playEncoded((element ??= new Audio()), audio, signal, () => paused);
      }
      const reader = audio.stream.getReader();
      try {
        const format = audio.format;
        if (
          !Number.isFinite(format.sampleRate) ||
          format.sampleRate < 8000 ||
          format.sampleRate > 192000
        )
          throw new RangeError('Invalid PCM sample rate');
        const ac = ctx();
        if (!paused) {
          await ac.resume();
          if (ac.state !== 'running')
            throw new DOMException('Audio requires a user gesture', 'NotAllowedError');
        }
        let pending = new Uint8Array(0);
        let nextTime = ac.currentTime;
        const sources = new Set<AudioBufferSourceNode>();
        const cancel = () => {
          sources.forEach((source) => {
            source.onended = null;
            source.stop();
          });
          sources.clear();
        };
        signal.addEventListener('abort', cancel, { once: true });
        const playBuffer = (bytes: Uint8Array) =>
          new Promise<void>((resolve, reject) => {
            check(signal);
            const frames = bytes.length / (2 * format.channels);
            const buffer = ac.createBuffer(format.channels, frames, format.sampleRate);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            for (let channel = 0; channel < format.channels; channel++) {
              const samples = buffer.getChannelData(channel);
              for (let frame = 0; frame < frames; frame++)
                samples[frame] =
                  view.getInt16((frame * format.channels + channel) * 2, true) / 32768;
            }
            const source = ac.createBufferSource();
            source.buffer = buffer;
            source.connect(ac.destination);
            sources.add(source);
            const abort = () => {
              source.disconnect();
              signal.removeEventListener('abort', abort);
              reject(abortError());
            };
            signal.addEventListener('abort', abort, { once: true });
            source.onended = () => {
              sources.delete(source);
              source.disconnect();
              signal.removeEventListener('abort', abort);
              resolve();
            };
            nextTime = Math.max(nextTime, ac.currentTime);
            source.start(nextTime);
            nextTime += frames / format.sampleRate;
          });
        const scheduled: Promise<void>[] = [];
        try {
          while (true) {
            const chunk = await read(reader, signal);
            if (chunk.done) break;
            // The host stream must also bound individual chunks; reject excessive payloads.
            if (chunk.value.length > 4 * 1024 * 1024)
              throw new RangeError('PCM chunk exceeds playback limit');
            const bytes = new Uint8Array(pending.length + chunk.value.length);
            bytes.set(pending);
            bytes.set(chunk.value, pending.length);
            const frameBytes = 2 * format.channels;
            const usable = bytes.length - (bytes.length % frameBytes);
            const windowBytes = Math.max(1, Math.floor(format.sampleRate / 8)) * frameBytes;
            for (let offset = 0; offset < usable; offset += windowBytes) {
              const completion = playBuffer(
                bytes.subarray(offset, Math.min(usable, offset + windowBytes)),
              );
              void completion.catch(() => {});
              scheduled.push(completion);
              if (scheduled.length >= 2) await scheduled.shift();
            }
            pending = bytes.slice(usable);
          }
          if (pending.length) throw new Error('Truncated PCM sample');
          await Promise.all(scheduled);
        } finally {
          signal.removeEventListener('abort', cancel);
          cancel();
        }
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    },
    reset() {
      paused = false;
      element?.pause();
    },
    dispose() {
      element?.pause();
      element?.removeAttribute('src');
      if (context) void context.close();
    },
  };
}
