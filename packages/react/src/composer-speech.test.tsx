// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createSpeechSession, createTextareaComposerAdapter, type ComposerSpeech,
  type SpeechSessionConfig } from '@flow-voice/browser';
import { useComposerSpeech } from './composer-speech.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((cleanup) => cleanup()));

function fixture() {
  const session = createSpeechSession({
    synthesize: async () => { throw new Error('not used'); }, workletUrl: '/worklet.js',
    createTransport: () => ({ connect: async () => {}, send: async () => {}, close() {} }),
  });
  cleanups.push(() => session.dispose());
  const composer = createTextareaComposerAdapter({
    element: document.createElement('textarea'), canSubmit: () => true, submit: async () => {},
  });
  cleanups.push(() => composer.dispose());
  const config: SpeechSessionConfig = {
    stt: { enabled: true, sampleRates: [24000], defaults: {} }, tts: { enabled: true },
  };
  const preferences = {
    sendAfterPause: false, silenceMs: 1500, sendOnWord: false, keyword: '', stopAfterSend: false,
  };
  const options: Parameters<typeof useComposerSpeech>[0] = {
    session, composer, owner: 'a', config, preferences,
  };
  let value!: ReturnType<typeof useComposerSpeech>;
  function Host() { value = useComposerSpeech(options); return null; }
  const root = createRoot(document.createElement('div'));
  cleanups.push(() => act(() => root.unmount()));
  const disposals: ReturnType<typeof vi.spyOn>[] = [];
  const original = session.bindComposer.bind(session);
  const bind = vi.spyOn(session, 'bindComposer').mockImplementation((...args) => {
    const binding: ComposerSpeech = original(...args);
    disposals.push(vi.spyOn(binding, 'dispose'));
    return binding;
  });
  const render = (strict = false) => act(() => root.render(strict ? <StrictMode><Host /></StrictMode> : <Host />));
  return { options, bind, disposals, render, value: () => value };
}

it('pairs every StrictMode binding with disposal and leaves no binding after capability loss', () => {
  const f = fixture();
  f.render(true);
  expect(f.bind).toHaveBeenCalledTimes(2);
  expect(f.disposals[0]).toHaveBeenCalledOnce();
  expect(f.disposals[1]).not.toHaveBeenCalled();
  expect(f.value().controller).not.toBeNull();
  f.options.config = { ...f.options.config, stt: { ...f.options.config.stt, enabled: false } };
  f.render(true);
  expect(f.disposals[1]).toHaveBeenCalledOnce();
  expect(f.value()).toEqual({ controller: null, call: null });
});

it('reads latest preferences without rebuilding for object identity or send-policy changes', () => {
  const f = fixture();
  f.render();
  const controller = f.value().controller;
  f.options.config = { ...f.options.config, stt: { ...f.options.config.stt, sampleRates: [123, 24000, 48000] } };
  f.options.preferences = { ...f.options.preferences, keyword: 'send', sendOnWord: true };
  f.render();
  expect(f.bind).toHaveBeenCalledOnce();
  expect(f.value().controller).toBe(controller);
  expect(f.bind.mock.calls[0]![1].preferences()).toMatchObject({ keyword: 'send', sendOnWord: true });
});

it('rebinds on real language, rate, owner, availability and TTS changes', () => {
  const f = fixture();
  f.render();
  f.options.preferences = { ...f.options.preferences, language: 'fr' };
  f.render();
  f.options.owner = 'b';
  f.render();
  f.options.config = { ...f.options.config, stt: { ...f.options.config.stt, sampleRates: [16000] } };
  f.render();
  expect(f.bind).toHaveBeenCalledTimes(4);
  f.options.config = { ...f.options.config, tts: { enabled: false } };
  f.render();
  expect(f.bind).toHaveBeenCalledTimes(5);
  expect(f.value().call).toBeNull();
  expect(f.disposals.slice(0, 4).every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  f.options.enabled = false;
  f.render();
  expect(f.value().controller).toBeNull();
  f.options.enabled = true;
  f.render();
  expect(f.bind).toHaveBeenCalledTimes(6);
});

it('does not bind unsupported rates, missing composers or absent sessions', () => {
  const f = fixture();
  f.options.config.stt.sampleRates = [123];
  f.render();
  expect(f.value().controller).toBeNull();
  expect(f.bind).not.toHaveBeenCalled();
  f.options.config.stt.sampleRates = [24000];
  f.options.composer = null;
  f.render();
  expect(f.bind).not.toHaveBeenCalled();
  f.options.session = null;
  f.render();
  expect(f.value()).toEqual({ controller: null, call: null });
});
