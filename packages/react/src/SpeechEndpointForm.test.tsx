// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SpeechEndpointForm } from './SpeechEndpointForm.js';
import type { SpeechEndpointTestResult } from './SpeechEndpointForm.js';
import type { SpeechEndpointView } from '@flow-voice/core';

afterEach(cleanup);
const model = 'nemotron-speech-streaming-en-0.6b-gguf';
const initial: SpeechEndpointView = { provider: 'openai', model: 'model', baseUrl: 'http://172.17.0.1:3100', keyHint: '…1234', options: {} };
const providers = [{ id: 'openai', name: 'OpenAI' }, { id: 'moss-compat', name: 'MOSS' }];

it.each(['openai', 'moss-compat'])('consumes a JSON server result verbatim and saves corrected %s REST settings without a key', async (provider) => {
  const onTest = vi.fn(async () => JSON.parse(JSON.stringify({
    stt: { ok: true, verified: true, live: false }, models: [model], baseUrl: 'http://172.17.0.1:3100/v1',
  })) as SpeechEndpointTestResult);
  const onSave = vi.fn(async () => null);
  const { container } = render(<SpeechEndpointForm kind="stt" initial={null} providers={providers} onTest={onTest} onSave={onSave} />);
  fireEvent.change(screen.getByLabelText('Provider'), { target: { value: provider } });
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'model' } });
  fireEvent.change(screen.getByLabelText('Base URL (optional)'), { target: { value: initial.baseUrl } });
  fireEvent.click(screen.getByText('Test connection'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Added /v1 to the endpoint address.'));
  expect(screen.getByRole('status').textContent).toContain("This server doesn't support live; using transcribe-after-pauses");
  expect((screen.getByLabelText('Base URL (optional)') as HTMLInputElement).value).toBe('http://172.17.0.1:3100/v1');
  expect((screen.getByLabelText('Connection') as HTMLSelectElement).value).toBe('rest');
  const input = screen.getByLabelText('Model') as HTMLInputElement;
  expect(container.querySelector('datalist')?.id).toBe(input.getAttribute('list'));
  expect(container.querySelector('datalist option')?.getAttribute('value')).toBe(model);
  fireEvent.change(input, { target: { value: 'freely-typed-model' } });
  expect(container.querySelectorAll('datalist option')).toHaveLength(1);
  fireEvent.click(screen.getByText('Save speech-to-text'));
  await waitFor(() => expect(onSave).toHaveBeenCalledExactlyOnceWith({
    provider, model: 'freely-typed-model', baseUrl: 'http://172.17.0.1:3100/v1', options: { sttTransport: 'rest' },
  }));
  expect(onTest.mock.calls[0]).toEqual([{ provider, model: 'model', baseUrl: initial.baseUrl, options: {} }]);
  await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(0));
});

it('keeps a saved key across corrected and manually edited paths, but blocks a different origin', async () => {
  const onTest = vi.fn(async () => ({ stt: { ok: true as const, verified: true as const, live: false }, baseUrl: `${initial.baseUrl}/v1` }));
  const onSave = vi.fn(async () => initial);
  render(<SpeechEndpointForm kind="stt" initial={initial} providers={providers} onTest={onTest} onSave={onSave} />);
  fireEvent.click(screen.getByText('Test connection'));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Added /v1'));
  fireEvent.click(screen.getByText('Save speech-to-text'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ provider: 'openai', model: 'model', baseUrl: `${initial.baseUrl}/v1`, options: { sttTransport: 'rest' } }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saved'));
  fireEvent.change(screen.getByLabelText('Base URL (optional)'), { target: { value: `${initial.baseUrl}/other-path` } });
  fireEvent.click(screen.getByText('Test connection'));
  await waitFor(() => expect(onTest).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByText('Test connection')).not.toHaveProperty('disabled', true));
  fireEvent.change(screen.getByLabelText('Base URL (optional)'), { target: { value: 'http://127.0.0.1:3100/v1' } });
  fireEvent.click(screen.getByText('Test connection'));
  expect(screen.getByText('Enter a new API key when changing the provider or endpoint origin.')).toBeTruthy();
  expect(onTest).toHaveBeenCalledTimes(2);
});

it('shows a custom voice failure without offering OpenAI built-in names', async () => {
  const onTest = vi.fn(async () => JSON.parse(JSON.stringify({ voiceError: "Couldn't load voices from this server" })) as SpeechEndpointTestResult);
  render(<SpeechEndpointForm kind="tts" initial={initial} providers={providers}
    choices={{ status: 'ready', voices: [{ id: 'alloy', name: 'alloy' }, { id: 'nova', name: 'nova' }] }}
    onTest={onTest} onSave={async () => null} />);
  fireEvent.click(screen.getByText('Test connection'));
  await waitFor(() => expect(screen.getByText("Couldn't load voices from this server")).toBeTruthy());
  expect(screen.queryByRole('option', { name: 'alloy' })).toBeNull();
  expect(screen.queryByRole('option', { name: 'nova' })).toBeNull();
});

it('ignores stale corrections, models and REST defaults after editing during Test', async () => {
  let resolve!: (result: SpeechEndpointTestResult) => void;
  const onTest = () => new Promise<SpeechEndpointTestResult>((done) => { resolve = done; });
  const { container } = render(<SpeechEndpointForm kind="stt" initial={initial} providers={providers} onTest={onTest} onSave={async () => null} />);
  fireEvent.click(screen.getByText('Test connection'));
  fireEvent.change(screen.getByLabelText('Base URL (optional)'), { target: { value: `${initial.baseUrl}/edited` } });
  await act(async () => resolve({ stt: { ok: true, verified: true, live: false }, models: [model], baseUrl: `${initial.baseUrl}/v1` }));
  expect((screen.getByLabelText('Base URL (optional)') as HTMLInputElement).value).toBe(`${initial.baseUrl}/edited`);
  expect((screen.getByLabelText('Connection') as HTMLSelectElement).value).toBe('');
  expect(container.querySelectorAll('datalist option')).toHaveLength(0);
  expect(screen.getByRole('status').textContent).toBe('');
});

it('resets discovered models when resetting or changing endpoint identity', async () => {
  const onTest = async () => ({ stt: { ok: true as const, verified: true as const, live: true }, models: [model] });
  const { container } = render(<SpeechEndpointForm kind="stt" initial={initial} providers={providers} onTest={onTest} onSave={async () => null} />);
  fireEvent.click(screen.getByText('Test connection'));
  await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Model'), { target: { value: model } });
  fireEvent.click(screen.getByText('Reset'));
  expect(container.querySelectorAll('datalist option')).toHaveLength(0);
  fireEvent.click(screen.getByText('Test connection'));
  await waitFor(() => expect(container.querySelectorAll('datalist option')).toHaveLength(1));
  fireEvent.change(screen.getByLabelText('Base URL (optional)'), { target: { value: `${initial.baseUrl}/v1` } });
  expect(container.querySelectorAll('datalist option')).toHaveLength(0);
});
