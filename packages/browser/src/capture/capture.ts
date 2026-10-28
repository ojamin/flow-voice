import type { SpeechError } from '@flow-voice/core';
import type { AudioCapture, AudioCaptureOptions } from '../index.js';
import { PcmResampler } from './resampler.js';

export function captureError(error: unknown): SpeechError {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return {
      code: 'unauthorized',
      message:
        'Microphone permission was denied. Allow microphone access in your browser settings.',
    };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return {
      code: 'unsupported',
      message: 'No microphone was found. Connect a microphone and try again.',
    };
  return {
    code: 'provider_error',
    message: 'The microphone could not be started. Check that it is available and try again.',
  };
}

export function createAudioCapture(options: AudioCaptureOptions): AudioCapture {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let node: AudioWorkletNode | undefined;
  let resampler: PcmResampler | undefined;
  let stopped = false;
  let started = false;
  let stopPromise: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopped = true;
    stopPromise = Promise.resolve();
    window.removeEventListener('pagehide', onPageHide);
    options.signal.removeEventListener('abort', onAbort);
    if (node) node.port.onmessage = null;
    source?.disconnect();
    node?.disconnect();
    stream?.getTracks().forEach((track) => track.stop());
    if (!options.signal.aborted) {
      for (const tail of resampler?.flush() ?? []) options.onFrame(tail.audio, tail.rms);
    }
    stopPromise = context?.close().catch(() => {}) ?? Promise.resolve();
    return stopPromise;
  };
  const onAbort = () => {
    void stop();
  };
  const onPageHide = () => {
    void stop();
  };
  return {
    async start() {
      if (started) throw new Error('Capture is single-use');
      started = true;
      if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        const error: SpeechError = {
          code: 'unsupported',
          message: 'Microphone access requires a secure (HTTPS) browser context.',
        };
        options.onError(error);
        throw error;
      }
      if (typeof AudioContext !== 'function' || typeof AudioWorkletNode !== 'function') {
        const error: SpeechError = {
          code: 'unsupported',
          message:
            'This browser does not support live microphone audio processing. Use a current browser.',
        };
        options.onError(error);
        throw error;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
      window.addEventListener('pagehide', onPageHide);
      try {
        if (options.signal.aborted || stopped) return;
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
          video: false,
        });
        if (stopped || options.signal.aborted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        context = new AudioContext({ latencyHint: 'interactive' });
        try {
          await context.audioWorklet.addModule(
            options.workletUrl ?? new URL('./worklet.js', import.meta.url),
          );
        } catch (error) {
          if (!options.inlineWorklet?.cspAllowsBlob || stopped) throw error;
          const url = URL.createObjectURL(
            new Blob([options.inlineWorklet.source], { type: 'text/javascript' }),
          );
          try {
            await context.audioWorklet.addModule(url);
          } finally {
            URL.revokeObjectURL(url);
          }
        }
        if (stopped || options.signal.aborted) return;
        resampler = new PcmResampler(context.sampleRate, options.format.sampleRate);
        source = context.createMediaStreamSource(stream);
        node = new AudioWorkletNode(context, 'flow-voice-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
          if (stopped) return;
          for (const frame of resampler!.push(data)) options.onFrame(frame.audio, frame.rms);
        };
        node.onprocessorerror = () => {
          options.onError({
            code: 'provider_error',
            message: 'Microphone audio processing stopped unexpectedly.',
          });
          void stop();
        };
        source.connect(node);
        // Processor output is silence, but a destination keeps render quanta flowing.
        node.connect(context.destination);
        await context.resume();
      } catch (cause) {
        const wasStopped = stopped;
        await stop();
        if (options.signal.aborted || wasStopped) return;
        const error = captureError(cause);
        options.onError(error);
        throw error;
      }
    },
    stop,
  };
}
