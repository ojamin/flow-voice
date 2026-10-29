// @vitest-environment jsdom
import { createRef, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createVoiceMode } from '@flow-voice/browser';
import type {
  CallSession,
  CallSessionSnapshot,
  DictationController,
  DictationSnapshot,
  SpeechPlayer,
  SpeechPlayerSnapshot,
} from '@flow-voice/browser';
import type {
  SpeechEndpointView,
  SpeechEndpointWrite,
  SpeechUserPreferences,
} from '@flow-voice/core';
import {
  CallControls,
  MicButton,
  PlayerControls,
  SpeechEndpointForm,
  SpeechPreferencesForm,
  VoiceControls,
  VoiceSelect,
} from './index.js';
import type { SpeechControlSlots } from './index.js';

afterEach(cleanup);
// jsdom has no CSS.escape; these generated identifiers contain only safe identifier characters.
beforeAll(() => vi.stubGlobal('CSS', { escape: (value: string) => value }));
afterAll(() => vi.unstubAllGlobals());
const choices = {
  status: 'ready' as const,
  voices: [
    { id: 'nova', name: 'Nova' },
    { id: 'echo', name: 'Echo' },
  ],
};
const endpoint: SpeechEndpointView = {
  provider: 'openai',
  model: 'tts-1',
  baseUrl: null,
  keyHint: '…1234',
  options: { voice: 'nova', speed: 1 },
};
const preferences: SpeechUserPreferences = {
  sendAfterPause: false,
  sendOnWord: false,
  silenceMs: 1500,
  keyword: '',
  stopAfterSend: false,
  speakerVoices: {},
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function store<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish(next: T) {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
}
function player(status: SpeechPlayerSnapshot['status'] = 'playing') {
  return {
    ...store<SpeechPlayerSnapshot>({
      status,
      messageId: status === 'idle' ? null : 'reply',
      sectionOrdinal: 0,
      queuedMessages: 0,
      error: null,
    }),
    unlock: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    pause: vi.fn(),
    stop: vi.fn(),
    skipSection: vi.fn(),
    skipToEnd: vi.fn(),
    enqueue: vi.fn(),
    append: vi.fn(),
    dispose: vi.fn(),
    setBackgroundAudio: vi.fn(async () => {}),
  } satisfies SpeechPlayer;
}
const slots: SpeechControlSlots = {
  Button: (props: ComponentPropsWithRef<'button'>) => <button {...props} data-adapter="button" />,
  Input: (props: ComponentPropsWithRef<'input'>) => <input {...props} data-adapter="input" />,
  Select: (props: ComponentPropsWithRef<'select'>) => <select {...props} data-adapter="select" />,
  Field: ({ id, label, description, error, children }) => (
    <div>
      <label htmlFor={id}>{label}</label>
      {children}
      {description && <span id={`${id}-description`}>{description}</span>}
      {error && (
        <span id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  ),
};

describe.each([undefined, slots])('native controls and slot adapter %s', (adapter) => {
  it('retains saved voice until an authoritative nonempty catalog, and retries', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const onChange = vi.fn();
    const view = render(
      <VoiceSelect
        slots={adapter}
        value="old"
        onChange={onChange}
        choices={{ status: 'loading', voices: [] }}
      />,
    );
    expect(
      (screen.getByRole('option', { name: 'old (saved)' }) as HTMLOptionElement).disabled,
    ).toBe(false);
    view.rerender(
      <VoiceSelect
        slots={adapter}
        value="old"
        onChange={onChange}
        choices={{ status: 'ready', voices: [] }}
      />,
    );
    expect(screen.getByRole('option', { name: 'old (saved)' })).toBeTruthy();
    view.rerender(
      <VoiceSelect slots={adapter} value="old" onChange={onChange} choices={choices} />,
    );
    expect(
      (screen.getByRole('option', { name: 'old (not available)' }) as HTMLOptionElement).disabled,
    ).toBe(true);
    await user.selectOptions(screen.getByRole('combobox'), 'nova');
    expect(onChange).toHaveBeenLastCalledWith('nova');
    view.rerender(
      <VoiceSelect
        slots={adapter}
        value="old"
        onChange={onChange}
        choices={{ status: 'error', voices: [], retry }}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Retry voices' }));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('owns Voice toggle, keyboard scope selection, controlled voice and Escape focus', async () => {
    const user = userEvent.setup();
    const mode = createVoiceMode();
    const audio = player();
    function Host() {
      const [voice, setVoice] = useState<string>();
      return (
        <VoiceControls
          mode={mode}
          player={audio}
          conversation="chat"
          slots={adapter}
          voice={{ value: voice, onChange: setVoice, choices }}
        />
      );
    }
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Voice' }));
    expect(mode.isOnFor('chat')).toBe(true);
    expect(audio.unlock).toHaveBeenCalledOnce();
    const trigger = screen.getByRole('button', { name: 'Voice options' });
    await user.click(trigger);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'One chat' }));
    await user.keyboard('{ArrowRight}');
    expect(mode.getSnapshot().scope).toBe('on-screen');
    await user.selectOptions(screen.getByRole('combobox'), 'echo');
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('echo');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
  it('saves normalized unsaved endpoint, disables pending and cannot double save', async () => {
    const user = userEvent.setup();
    const done = deferred<SpeechEndpointView | null>();
    const onSave = vi.fn((_value: SpeechEndpointWrite) => done.promise);
    const onTest = vi.fn();
    render(
      <SpeechEndpointForm
        kind="tts"
        initial={endpoint}
        providers={[{ id: 'openai', name: 'OpenAI' }]}
        choices={choices}
        onSave={onSave}
        onTest={onTest}
        slots={adapter}
      />,
    );
    await user.clear(screen.getByRole('textbox', { name: 'Model' }));
    await user.type(screen.getByRole('textbox', { name: 'Model' }), ' new-model ');
    await user.dblClick(screen.getByRole('button', { name: 'Save text-to-speech' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ model: 'new-model', baseUrl: null });
    expect(
      (screen.getByRole('textbox', { name: 'Model' }) as HTMLInputElement).disabled ||
        screen.getByRole('textbox', { name: 'Model' }).closest('fieldset')?.disabled,
    ).toBe(true);
    await act(async () => done.resolve({ ...endpoint, model: 'new-model' }));
    expect(
      screen.getAllByRole('status').some((node) => node.textContent === 'Saved speech settings.'),
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Save text-to-speech' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  it('owns preferences fields, speaker overrides, async retry and reset', async () => {
    const user = userEvent.setup();
    const onSave = vi
      .fn(async (value: SpeechUserPreferences) => value)
      .mockRejectedValueOnce(new Error('Offline. Try again.'));
    render(
      <SpeechPreferencesForm
        initial={preferences}
        stt
        tts
        choices={choices}
        onSave={onSave}
        slots={adapter}
        speakerNames={['Ada']}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: 'Send when I pause' }));
    await user.type(screen.getByRole('combobox', { name: 'Speaker name' }), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Add speaker' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Voice for Ada' }), 'echo');
    await user.click(screen.getByRole('checkbox', { name: 'Mute Ada' }));
    await user.click(screen.getByRole('button', { name: 'Save voice preferences' }));
    expect(screen.getByRole('alert').textContent).toContain('Offline');
    await user.click(screen.getByRole('button', { name: 'Save voice preferences' }));
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((node) => node.textContent === 'Saved to your account.'),
      ).toBe(true),
    );
    expect(onSave).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sendAfterPause: true,
        speakerVoices: { Ada: { voice: 'echo', muted: true } },
      }),
    );
    await user.click(screen.getByRole('checkbox', { name: 'Send when I pause' }));
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(
      (screen.getByRole('checkbox', { name: 'Send when I pause' }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Remove Ada override' }));
    expect(screen.queryByRole('combobox', { name: 'Voice for Ada' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Speaker name' }));
  });
});

it('does not attach stale test success, voices or failure to an edited endpoint', async () => {
  const user = userEvent.setup();
  const test = deferred<{ ok: true; voices: { id: string; name: string }[] }>();
  const onTest = vi.fn(() => test.promise);
  render(
    <SpeechEndpointForm
      kind="tts"
      initial={endpoint}
      choices={choices}
      providers={[{ id: 'openai', name: 'OpenAI' }]}
      onSave={vi.fn()}
      onTest={onTest}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(onTest).toHaveBeenCalledWith({
    provider: 'openai',
    model: 'tts-1',
    baseUrl: null,
    options: endpoint.options,
  });
  await user.type(screen.getByRole('textbox', { name: 'Model' }), '-edited');
  await act(async () => test.resolve({ ok: true, voices: [{ id: 'stale', name: 'Stale voice' }] }));
  expect(screen.queryByText(/Connection successful/)).toBeNull();
  expect(screen.queryByRole('option', { name: 'Stale voice' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'Echo' })).toBeNull();
  expect(screen.getByRole('option', { name: 'nova (saved)' })).toBeTruthy();
});
it('tests unsaved key without saving, clears it on reset and sends explicit clear', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => null);
  const onTest = vi.fn(async () => ({ ok: true as const }));
  render(
    <SpeechEndpointForm
      kind="tts"
      initial={endpoint}
      providers={[{ id: 'openai', name: 'OpenAI' }]}
      onSave={onSave}
      onTest={onTest}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Replace key' }));
  await user.type(screen.getByLabelText('API key'), ' secret-key ');
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(onTest).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'secret-key' }));
  expect(onSave).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Reset' }));
  expect(screen.queryByLabelText('API key')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Disable and clear configuration' }));
  expect(onSave).toHaveBeenCalledWith({ clear: true });
  expect(
    screen
      .getAllByRole('status')
      .some((node) => node.textContent?.includes('Configuration cleared')),
  ).toBe(true);
});
it('requires a new key on identity change, adapts server field errors and permits retry', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn(async () => endpoint).mockRejectedValueOnce(new Error('Key rejected.'));
  render(
    <SpeechEndpointForm
      kind="tts"
      initial={endpoint}
      providers={[{ id: 'openai', name: 'OpenAI' }]}
      onSave={onSave}
      onTest={vi.fn()}
      onErrorFields={() => ({ apiKey: 'Invalid key' })}
    />,
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Base URL (optional)' }),
    'https://example.test',
  );
  await user.click(screen.getByRole('button', { name: 'Save text-to-speech' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(
    screen.getByText('Enter a new API key when changing the provider or base URL.'),
  ).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Replace key' }));
  await user.click(screen.getByRole('button', { name: 'Replace key' }));
  await user.type(screen.getByLabelText('API key'), 'new-key');
  await user.click(screen.getByRole('button', { name: 'Save text-to-speech' }));
  expect(screen.getByLabelText('API key').getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(screen.getByLabelText('API key'));
  expect(screen.getByText('Invalid key')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save text-to-speech' }));
  expect(onSave).toHaveBeenCalledTimes(2);
});
it('discards test errors after initial endpoint changes and announces current test failure for retry', async () => {
  const user = userEvent.setup();
  const test = deferred<{ ok: true }>();
  const onTest = vi.fn(() => test.promise);
  const props = {
    kind: 'stt' as const,
    providers: [{ id: 'openai', name: 'OpenAI' }],
    onSave: vi.fn(),
    onTest,
  };
  const view = render(<SpeechEndpointForm {...props} initial={endpoint} />);
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  view.rerender(<SpeechEndpointForm {...props} initial={{ ...endpoint, model: 'new' }} />);
  await act(async () => test.reject(new Error('Stale failure')));
  expect(screen.queryByText('Stale failure')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(screen.getByText('Stale failure')).toBeTruthy();
});
it('owns call start rejection cleanup, retry, mute, end and failed state', async () => {
  const user = userEvent.setup();
  const state = store<CallSessionSnapshot>({ status: 'idle', muted: false, failed: false });
  const attempt = deferred<void>();
  const call: CallSession = {
    ...state,
    start: vi.fn(() => attempt.promise),
    end: vi.fn(),
    setMuted: vi.fn(),
    setDictation: vi.fn(),
    dispose: vi.fn(),
  };
  render(<CallControls call={call} slots={slots} />);
  await user.dblClick(screen.getByRole('button', { name: 'Call' }));
  expect(call.start).toHaveBeenCalledOnce();
  await act(async () => attempt.reject(new Error('Permission denied.')));
  expect(call.end).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert').textContent).toContain(
    'Could not start the call. Check microphone and audio access',
  );
  await user.click(screen.getByRole('button', { name: 'Call' }));
  expect(call.start).toHaveBeenCalledTimes(2);
  act(() => state.publish({ status: 'active', muted: false, failed: false }));
  await user.click(screen.getByRole('button', { name: 'Mute' }));
  expect(call.setMuted).toHaveBeenCalledWith(true);
  await user.click(screen.getByRole('button', { name: 'End call' }));
  expect(call.end).toHaveBeenCalledTimes(3);
  act(() => state.publish({ status: 'idle', muted: false, failed: true }));
  expect(screen.getByRole('alert').textContent).toContain(
    'repeated microphone or speech service failures',
  );
});
it('derives player controls for slots, blocked, resume/error, idle and disabled', async () => {
  const user = userEvent.setup();
  const audio = player('blocked');
  const view = render(<PlayerControls player={audio} slots={slots} hideWhenIdle />);
  expect(screen.queryByRole('button', { name: 'Pause speech' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Enable audio' }));
  expect(
    screen.getByRole('button', { name: 'Enable audio' }).getAttribute('data-flow-voice-action'),
  ).toBe('enable-audio');
  expect(audio.unlock).toHaveBeenCalledOnce();
  act(() =>
    audio.publish({
      ...audio.getSnapshot(),
      status: 'error',
      error: { code: 'provider_error', message: 'Playback failed' },
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Resume speech' }));
  expect(
    screen.getByRole('button', { name: 'Resume speech' }).getAttribute('data-flow-voice-action'),
  ).toBe('resume');
  expect(audio.resume).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert').textContent).toBe('Playback failed');
  await user.click(screen.getByRole('button', { name: 'Skip section' }));
  await user.click(screen.getByRole('button', { name: 'Skip to end of message' }));
  await user.click(screen.getByRole('button', { name: 'Stop speech' }));
  expect(audio.skipSection).toHaveBeenCalledOnce();
  expect(audio.skipToEnd).toHaveBeenCalledOnce();
  expect(audio.stop).toHaveBeenCalledOnce();
  view.rerender(<PlayerControls player={audio} slots={slots} disabled />);
  expect(screen.getAllByRole('button').every((node) => (node as HTMLButtonElement).disabled)).toBe(
    true,
  );
  act(() =>
    audio.publish({ ...audio.getSnapshot(), status: 'idle', messageId: null, error: null }),
  );
  view.rerender(<PlayerControls player={audio} slots={slots} hideWhenIdle />);
  expect(screen.queryByRole('group')).toBeNull();
});
it('forwards complete mic props to slot adapter including ref, finalizing disable and countdown action', async () => {
  const user = userEvent.setup();
  const state = store<DictationSnapshot>({
    status: 'listening',
    committed: '',
    tentative: '',
    rms: 0.3,
    countdownMs: 1000,
    error: null,
  });
  const controller: DictationController = {
    ...state,
    start: vi.fn(async () => {}),
    finish: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    cancelAutoSend: vi.fn(),
    dispose: vi.fn(async () => {}),
    notifyUserActivity: vi.fn(),
  };
  const ref = createRef<HTMLButtonElement>();
  render(<MicButton controller={controller} slots={slots} showLevel ref={ref} />);
  expect(ref.current).toBe(screen.getByRole('button', { name: 'Stop dictation' }));
  expect(screen.getByText('Listening…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Stop dictation' }).getAttribute('aria-pressed')).toBe(
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Cancel automatic send' }));
  expect(controller.cancelAutoSend).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: 'Stop dictation' }));
  expect(controller.finish).toHaveBeenCalledOnce();
  act(() => state.publish({ ...state.getSnapshot(), status: 'finalizing' }));
  expect(screen.getByText('Finishing…')).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Finishing dictation' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
it('preserves preference pending admission even for native form submissions', async () => {
  const user = userEvent.setup();
  const done = deferred<SpeechUserPreferences>();
  const onSave = vi.fn(() => done.promise);
  render(<SpeechPreferencesForm initial={preferences} stt tts choices={choices} onSave={onSave} />);
  await user.click(screen.getByRole('checkbox', { name: 'Send when I pause' }));
  const form = screen.getByRole('form', { name: 'Voice preferences' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(onSave).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Saving…' }).closest('fieldset')?.disabled).toBe(true);
  await act(async () => done.resolve({ ...preferences, sendAfterPause: true }));
});
it('passes derived native options props to a host popover without menu-role mimicry', async () => {
  const user = userEvent.setup();
  const mode = createVoiceMode();
  const change = vi.fn();
  render(
    <VoiceControls
      mode={mode}
      player={player()}
      conversation="chat"
      voice={{ choices, onChange: change }}
      renderOptions={({ triggerProps, content, open, onOpenChange }) => (
        <section>
          <button {...triggerProps} />
          {open && (
            <div>
              {content}
              <button type="button" onClick={() => onOpenChange(false)}>
                Close options
              </button>
            </div>
          )}
        </section>
      )}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Voice options' }));
  await user.click(screen.getByRole('radio', { name: 'Chat on screen' }));
  expect(mode.getSnapshot().scope).toBe('on-screen');
  await user.selectOptions(screen.getByRole('combobox'), 'nova');
  expect(change).toHaveBeenCalledWith('nova');
  expect(screen.queryByRole('menu')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Close options' }));
  expect(screen.getByRole('button', { name: 'Voice options' }).getAttribute('aria-expanded')).toBe(
    'false',
  );
});
it('ignores a late start failure after the user has ended the call', async () => {
  const user = userEvent.setup();
  const state = store<CallSessionSnapshot>({ status: 'idle', muted: false, failed: false });
  const attempt = deferred<void>();
  const call: CallSession = {
    ...state,
    start: vi.fn(() => {
      state.publish({ status: 'active', muted: false, failed: false });
      return attempt.promise;
    }),
    end: vi.fn(() => state.publish({ status: 'idle', muted: false, failed: false })),
    setMuted: vi.fn(),
    setDictation: vi.fn(),
    dispose: vi.fn(),
  };
  render(<CallControls call={call} />);
  await user.click(screen.getByRole('button', { name: 'Call' }));
  await user.click(screen.getByRole('button', { name: 'End call' }));
  await act(async () => attempt.reject(new Error('Late failure')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(call.end).toHaveBeenCalledOnce();
});
it('keeps unsaved STT options, tests them without a write and resets the edited draft', async () => {
  const user = userEvent.setup();
  const onTest = vi.fn(async () => ({ ok: true as const }));
  const onSave = vi.fn();
  render(
    <SpeechEndpointForm
      kind="stt"
      initial={null}
      providers={[{ id: 'openai', name: 'OpenAI' }]}
      onSave={onSave}
      onTest={onTest}
    />,
  );
  await user.type(screen.getByRole('textbox', { name: 'Model' }), ' whisper-1 ');
  await user.type(screen.getByRole('textbox', { name: 'Default language (optional)' }), ' en ');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Connection' }), 'rest');
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(onTest).toHaveBeenCalledWith({
    provider: 'openai',
    model: 'whisper-1',
    baseUrl: null,
    options: { language: 'en', sttTransport: 'rest' },
  });
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole('status').textContent).toBe('Connection successful.');
  await user.click(screen.getByRole('button', { name: 'Reset' }));
  expect((screen.getByRole('textbox', { name: 'Model' }) as HTMLInputElement).value).toBe('');
});
it('maps canonical endpoint validation issues to provider, model and speed fields', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  const onTest = vi.fn();
  render(<SpeechEndpointForm kind="tts" initial={null} providers={[]} onSave={onSave} onTest={onTest} />);
  await user.clear(screen.getByRole('spinbutton', { name: 'Default speed' }));
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(screen.getByRole('combobox', { name: 'Provider' }).getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'Model' }).getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('spinbutton', { name: 'Default speed' }).getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByText('Choose a provider.')).toBeTruthy();
  expect(screen.getByText('Enter a model.')).toBeTruthy();
  expect(screen.getByText('Speed must be between 0.5 and 2.')).toBeTruthy();
  expect(onTest).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

it('shows the concrete OpenAI Connection option only there and never sends it to another provider', async () => {
  const user = userEvent.setup();
  const onTest = vi.fn(async () => ({ ok: true as const }));
  render(
    <SpeechEndpointForm
      kind="stt"
      initial={null}
      providers={[
        { id: 'openai', name: 'OpenAI' },
        { id: 'deepgram', name: 'Deepgram' },
      ]}
      onSave={vi.fn()}
      onTest={onTest}
    />,
  );
  expect((screen.getByRole('combobox', { name: 'Connection' }) as HTMLSelectElement).value).toBe(
    '',
  );
  await user.selectOptions(screen.getByRole('combobox', { name: 'Connection' }), 'rest');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Provider' }), 'deepgram');
  expect(screen.queryByRole('combobox', { name: 'Connection' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Model' }), 'nova-3');
  await user.click(screen.getByRole('button', { name: 'Test connection' }));
  expect(onTest).toHaveBeenCalledWith({
    provider: 'deepgram',
    model: 'nova-3',
    baseUrl: null,
    options: {},
  });
});
it('uses native constraints to block invalid preferences before the save callback', async () => {
  const user = userEvent.setup();
  const onSave = vi.fn();
  render(<SpeechPreferencesForm initial={preferences} stt tts choices={choices} onSave={onSave} />);
  const delay = screen.getByRole('spinbutton', { name: 'Silence delay (seconds)' });
  await user.clear(delay);
  await user.type(delay, '61');
  await user.click(screen.getByRole('button', { name: 'Save voice preferences' }));
  expect(onSave).not.toHaveBeenCalled();
  expect((delay as HTMLInputElement).validity.rangeOverflow).toBe(true);
});
it('keeps active-call cleanup available when new-call admission is disabled', async () => {
  const user = userEvent.setup();
  const state = store<CallSessionSnapshot>({ status: 'active', muted: false, failed: false });
  const call: CallSession = {
    ...state,
    start: vi.fn(),
    end: vi.fn(),
    setMuted: vi.fn(),
    setDictation: vi.fn(),
    dispose: vi.fn(),
  };
  render(<CallControls call={call} disabled />);
  expect((screen.getByRole('button', { name: 'Call' }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Mute' }));
  expect(call.setMuted).toHaveBeenCalledWith(true);
  await user.click(screen.getByRole('button', { name: 'End call' }));
  expect(call.end).toHaveBeenCalledOnce();
});
