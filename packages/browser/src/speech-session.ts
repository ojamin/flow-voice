import { autoSendFor, pcmInputSchema, type DictationPreference } from '@flow-voice/core';
import { createConversationMessages, type ConversationMessages } from './auto-read/conversation.js';
import { createVoiceMode, type VoiceMode } from './voice-mode.js';
import { createSpeechPlayer } from './player/player.js';
import { createDictationController } from './dictation/controller.js';
import { createCallSession, type CallSession } from './call-session.js';
import type { createAudioCapture } from './capture/capture.js';
import type { ComposerAdapter, DictationController, DictationTransport, SpeechPlayer, SynthesisFetcher } from './index.js';

export interface SpeechSessionConfig {
  stt: { enabled: boolean; sampleRates: readonly number[]; defaults: { language?: string } };
  tts: { enabled: boolean };
}
export interface ComposerSpeech {
  dictation: DictationController;
  call: CallSession | null;
  dispose(): void;
}
export interface ComposerSpeechOptions {
  config(): SpeechSessionConfig;
  preferences(): DictationPreference & { language?: string };
  activityTarget?: EventTarget;
}
export interface SpeechSession {
  readonly player: SpeechPlayer;
  readonly voiceMode: VoiceMode;
  readonly messages: ConversationMessages;
  currentConversation(): string | null;
  claimConversation(id: string): () => void;
  leaveSurface(): void;
  invalidateDrafts(): void;
  /** Bind only when STT is enabled and supportedDictationRate returns a rate. */
  bindComposer(composer: ComposerAdapter, options: ComposerSpeechOptions): ComposerSpeech;
  dispose(): void;
}

/** Shared admission/rate choice for imperative hosts and effect-owned React bindings. */
export function supportedDictationRate(config: SpeechSessionConfig): number | undefined {
  return config.stt.sampleRates.find((rate) => pcmInputSchema.shape.sampleRate.safeParse(rate).success);
}

/** Effect-owned composition. Transport, authenticated synthesis and activity source stay host-owned. */
export function createSpeechSession(options: {
  synthesize: SynthesisFetcher;
  createTransport(): DictationTransport;
  workletUrl: string | URL;
  capture?: typeof createAudioCapture;
  onConversationChange?(id: string | null): void;
}): SpeechSession {
  const player = createSpeechPlayer({ synthesize: options.synthesize });
  const voiceMode = createVoiceMode();
  const messages = createConversationMessages();
  const bindings = new Set<ComposerSpeech>();
  const claims = new Map<symbol, string>();
  let current: string | null = null;
  const audience = () => voiceMode.getSnapshot().scope === 'on-screen' && current === null
    ? null : voiceMode.readingChat();
  let selected: string | null = null;
  const updateAudience = () => {
    const next = audience();
    if (selected === next) return;
    selected = next;
    messages.setConversation(next);
    player.stop();
  };
  const unsubscribeVoice = voiceMode.subscribe(updateAudience);
  const endInput = () => {
    for (const binding of bindings) binding.call?.end();
    for (const binding of bindings) void binding.dictation.cancel();
  };
  const update = () => {
    const next = [...claims.values()].at(-1) ?? null;
    if (current === next) return;
    endInput();
    current = next;
    if (next !== null) voiceMode.setChatOnScreen(next);
    updateAudience();
    if (!voiceMode.getSnapshot().enabled || voiceMode.getSnapshot().scope === 'on-screen') {
      messages.invalidatePending();
      player.stop();
    }
    options.onConversationChange?.(next);
  };
  return {
    player, voiceMode, messages,
    currentConversation: () => current,
    claimConversation(id) {
      const token = Symbol();
      claims.set(token, id);
      update();
      return () => { claims.delete(token); update(); };
    },
    leaveSurface() {
      endInput();
      if (!voiceMode.getSnapshot().enabled || voiceMode.getSnapshot().scope === 'on-screen') {
        messages.invalidatePending();
        player.stop();
      }
    },
    invalidateDrafts() {
      // cancel invalidates composer ownership synchronously, before any controlled replacement.
      for (const binding of bindings) void binding.dictation.cancel();
    },
    bindComposer(composer, bindingOptions) {
      const config = bindingOptions.config();
      const rate = supportedDictationRate(config);
      if (!config.stt.enabled || rate === undefined) throw new Error('Dictation is unavailable');
      let call: CallSession | null = null;
      const inCall = () => call?.getSnapshot().status === 'active';
      const dictation = createDictationController({
        composer, transport: options.createTransport(),
        audio: pcmInputSchema.parse({ encoding: 'pcm_s16le', sampleRate: rate, channels: 1 }),
        workletUrl: options.workletUrl, capture: options.capture,
        language: bindingOptions.preferences().language ?? config.stt.defaults.language,
        get stopAfterSend() { return !inCall() && bindingOptions.preferences().stopAfterSend; },
        get autoSend() { return autoSendFor(bindingOptions.preferences(), { onCall: inCall() }); },
      });
      if (config.tts.enabled) call = createCallSession({
        dictation, player, metadata: { title: 'Voice call' },
        onVoiceChange: () => current ? voiceMode.enableFor(current) : () => {},
      });
      const activity = () => dictation.notifyUserActivity();
      bindingOptions.activityTarget?.addEventListener('pointerdown', activity, true);
      bindingOptions.activityTarget?.addEventListener('keydown', activity, true);
      const binding: ComposerSpeech = {
        dictation, call,
        dispose() {
          if (!bindings.delete(binding)) return;
          bindingOptions.activityTarget?.removeEventListener('pointerdown', activity, true);
          bindingOptions.activityTarget?.removeEventListener('keydown', activity, true);
          call?.dispose();
          void dictation.dispose();
        },
      };
      bindings.add(binding);
      return binding;
    },
    dispose() {
      unsubscribeVoice();
      for (const binding of bindings) binding.dispose();
      claims.clear();
      messages.invalidatePending();
      messages.setConversation(null);
      player.dispose();
    },
  };
}
