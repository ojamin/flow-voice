import { autoSendFor, pcmInputSchema } from '@flow-voice/core';
import { createConversationMessages } from './auto-read/conversation.js';
import { createVoiceMode } from './voice-mode.js';
import { createSpeechPlayer } from './player/player.js';
import { createDictationController } from './dictation/controller.js';
import { createCallSession } from './call-session.js';
/** Shared admission/rate choice for imperative hosts and effect-owned React bindings. */
export function supportedDictationRate(config) {
    return config.stt.sampleRates.find((rate) => pcmInputSchema.shape.sampleRate.safeParse(rate).success);
}
/** Effect-owned composition. Transport, authenticated synthesis and activity source stay host-owned. */
export function createSpeechSession(options) {
    const player = createSpeechPlayer({ synthesize: options.synthesize });
    const voiceMode = createVoiceMode();
    const messages = createConversationMessages();
    const bindings = new Set();
    const claims = new Map();
    let current = null;
    const audience = () => voiceMode.getSnapshot().scope === 'on-screen' && current === null
        ? null : voiceMode.readingChat();
    let selected = null;
    const updateAudience = () => {
        const next = audience();
        if (selected === next)
            return;
        selected = next;
        messages.setConversation(next);
        player.stop();
    };
    const unsubscribeVoice = voiceMode.subscribe(updateAudience);
    const endInput = () => {
        for (const binding of bindings)
            binding.call?.end();
        for (const binding of bindings)
            void binding.dictation.cancel();
    };
    const update = () => {
        const next = [...claims.values()].at(-1) ?? null;
        if (current === next)
            return;
        endInput();
        current = next;
        if (next !== null)
            voiceMode.setChatOnScreen(next);
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
            for (const binding of bindings)
                void binding.dictation.cancel();
        },
        bindComposer(composer, bindingOptions) {
            const config = bindingOptions.config();
            const rate = supportedDictationRate(config);
            if (!config.stt.enabled || rate === undefined)
                throw new Error('Dictation is unavailable');
            let call = null;
            const inCall = () => call?.getSnapshot().status === 'active';
            const dictation = createDictationController({
                composer, transport: options.createTransport(),
                audio: pcmInputSchema.parse({ encoding: 'pcm_s16le', sampleRate: rate, channels: 1 }),
                workletUrl: options.workletUrl, capture: options.capture,
                language: bindingOptions.preferences().language ?? config.stt.defaults.language,
                get stopAfterSend() { return !inCall() && bindingOptions.preferences().stopAfterSend; },
                get autoSend() { return autoSendFor(bindingOptions.preferences(), { onCall: inCall() }); },
            });
            if (config.tts.enabled)
                call = createCallSession({
                    dictation, player, metadata: { title: 'Voice call' },
                    onVoiceChange: () => current ? voiceMode.enableFor(current) : () => { },
                });
            const activity = () => dictation.notifyUserActivity();
            bindingOptions.activityTarget?.addEventListener('pointerdown', activity, true);
            bindingOptions.activityTarget?.addEventListener('keydown', activity, true);
            const binding = {
                dictation, call,
                dispose() {
                    if (!bindings.delete(binding))
                        return;
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
            for (const binding of bindings)
                binding.dispose();
            claims.clear();
            messages.invalidatePending();
            messages.setConversation(null);
            player.dispose();
        },
    };
}
//# sourceMappingURL=speech-session.js.map