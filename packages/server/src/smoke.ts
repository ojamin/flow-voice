import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { AudioFormat } from '@flow-voice/core';
import {
  createAdapters,
  createLiveTranscriptionSession,
  normalizeSpeechError,
  synthesize,
} from './index.js';

/** Explicit opt-in only. Never logs audio, transcripts, credentials or endpoints. */
export async function runSmoke(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const provider = env.FLOW_VOICE_SMOKE_PROVIDER ?? 'openai';
  const apiKey =
    env.FLOW_VOICE_SMOKE_API_KEY ?? (provider === 'openai' ? env.OPENAI_API_KEY : undefined);
  if (!apiKey) {
    console.warn('flow-voice smoke skipped: no API key.');
    return;
  }
  if (provider !== 'openai' && provider !== 'moss-compat')
    throw new Error('Smoke supports openai or moss-compat.');
  const config = {
    provider,
    apiKey,
    baseUrl: env.FLOW_VOICE_SMOKE_BASE_URL,
    model: env.FLOW_VOICE_SMOKE_TTS_MODEL ?? '',
  };
  const format: AudioFormat = {
    kind: 'pcm',
    encoding: 'pcm_s16le',
    sampleRate: provider === 'openai' ? 24000 : 48000,
    channels: provider === 'openai' ? 1 : 2,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const audio = await synthesize({
      adapter: createAdapters(config).tts!,
      text: 'Speech smoke test.',
      voice: env.FLOW_VOICE_SMOKE_VOICE,
      format,
      signal: controller.signal,
    });
    const reader = audio.stream.getReader();
    const first = await reader.read();
    if (first.done || !first.value.length) throw new Error('No audio received.');
    await reader.cancel();
    console.warn('flow-voice TTS first-chunk/cancel passed.');
    if (!env.FLOW_VOICE_SMOKE_PCM) {
      console.warn('flow-voice STT skipped: no raw PCM fixture.');
      return;
    }
    const pcm = await readFile(env.FLOW_VOICE_SMOKE_PCM);
    if (!pcm.length || pcm.length % 2 || pcm.length > 1_440_000)
      throw new Error('Expected nonempty mono PCM16, at most 30 seconds.');
    const sampleRate = provider === 'openai' ? 24000 : 16000;
    let partial = false,
      final = false,
      stopped = false;
    const runner = createLiveTranscriptionSession({
      adapter: createAdapters({
        ...config,
        model:
          env.FLOW_VOICE_SMOKE_STT_MODEL ?? (provider === 'openai' ? 'gpt-live-transcribe' : ''),
      }).stt!,
      signal: controller.signal,
      async send(message) {
        if (message.type === 'error') throw new Error(message.code);
        if (message.type === 'partial' && message.tentative) partial = true;
        if (message.type === 'final' && message.text) final = true;
        if (message.type === 'ended' && message.reason === 'stopped') stopped = true;
      },
    });
    await runner.receive({
      type: 'start',
      version: 1,
      audio: { encoding: 'pcm_s16le', sampleRate, channels: 1 },
    });
    const frameBytes = sampleRate * 2 * 0.08;
    for (let offset = 0; offset < pcm.length; offset += frameBytes) {
      controller.signal.throwIfAborted();
      await runner.receive({ type: 'audio', audio: pcm.subarray(offset, offset + frameBytes) });
      await new Promise<void>((done) => setTimeout(done, 80));
    }
    await runner.receive({ type: 'stop' });
    await runner.done;
    if (!partial || !final || !stopped)
      throw new Error('STT partial/final/stop acceptance failed.');
    console.warn('flow-voice STT partial/final/cleanup passed.');
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runSmoke().catch((error: unknown) => {
    console.error('flow-voice smoke failed:', normalizeSpeechError(error).code);
    process.exitCode = 1;
  });
}
