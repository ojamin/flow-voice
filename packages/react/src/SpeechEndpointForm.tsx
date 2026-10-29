import { useEffect, useId, useRef, useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import type {
  SpeechEndpointDraft,
  SpeechEndpointView,
  SpeechEndpointWrite,
  SpeechKind,
  Voice,
} from '@flow-voice/core';
import { Field, errorMessage } from './controls.js';
import type { SpeechControlAppearance } from './controls.js';
import { VoiceSelect } from './VoiceSelect.js';
import type { VoiceChoiceState } from './VoiceSelect.js';

export interface SpeechEndpointFormProps extends SpeechControlAppearance {
  kind: SpeechKind;
  initial: SpeechEndpointView | null;
  providers: readonly { id: string; name: string }[];
  choices?: VoiceChoiceState;
  onSave(value: SpeechEndpointWrite): Promise<SpeechEndpointView | null>;
  onTest(value: SpeechEndpointDraft): Promise<{ ok: true; voices?: readonly Voice[] }>;
  onErrorFields?(error: unknown): Readonly<Record<string, string>>;
  labels?: { save?: string; test?: string; clear?: string; reset?: string };
}
const editEndpoint = (initial: SpeechEndpointView | null, provider: string) => ({
  provider: initial?.provider ?? provider,
  model: initial?.model ?? '',
  baseUrl: initial?.baseUrl ?? '',
  apiKey: '',
  replacing: !initial?.keyHint,
  language: initial?.options.language ?? '',
  voice: initial?.options.voice,
  speed: String(initial?.options.speed ?? 1),
  sttTransport: initial?.options.sttTransport ?? '',
});
export function SpeechEndpointForm({
  kind,
  initial,
  providers,
  choices,
  onSave,
  onTest,
  onErrorFields,
  labels,
  slots,
  className,
}: SpeechEndpointFormProps) {
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(() => editEndpoint(initial, providers[0]?.id ?? ''));
  const [pending, setPending] = useState<'save' | 'test' | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [status, setStatus] = useState('');
  const [testedChoices, setTestedChoices] = useState<VoiceChoiceState>();
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  // Every edit invalidates the test's identity, even when the fields are changed back.
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setBaseline(initial);
    setDraft(editEndpoint(initial, providers[0]?.id ?? ''));
    setErrors({});
    setStatus('');
    setTestedChoices(undefined);
  }, [initial, kind]);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  useEffect(() => {
    if (Object.keys(errors).length)
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);
  const id = useId();
  const Input = slots?.Input ?? 'input';
  const Select = slots?.Select ?? 'select';
  const Button = slots?.Button ?? 'button';
  const Wrapper = slots?.Field ?? Field;
  const update = (patch: Partial<typeof draft>) => {
    revision.current++;
    setDraft((value) => ({ ...value, ...patch }));
    setStatus('');
    setErrors({});
    setTestedChoices(undefined);
  };
  const reset = () => {
    revision.current++;
    setDraft(editEndpoint(baseline, providers[0]?.id ?? ''));
    setErrors({});
    setStatus('');
    setTestedChoices(undefined);
  };
  const field = (
    name: string,
    label: string,
    props: InputHTMLAttributes<HTMLInputElement>,
    description?: string,
  ) => (
    <Wrapper
      key={name}
      id={`${id}-${name}`}
      label={label}
      error={errors[name]}
      description={description}
    >
      <Input
        type="text"
        {...props}
        id={`${id}-${name}`}
        aria-invalid={!!errors[name]}
        aria-describedby={
          [
            description ? `${id}-${name}-description` : '',
            errors[name] ? `${id}-${name}-error` : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
      />
    </Wrapper>
  );
  async function submit(action: 'save' | 'test' | 'clear') {
    if (busy.current) return;
    const issues: Record<string, string> = {};
    if (action !== 'clear') {
      if (!draft.provider.trim()) issues.provider = 'Choose a provider.';
      if (!draft.model.trim()) issues.model = 'Enter a model.';
      if (
        kind === 'tts' &&
        (!draft.speed.trim() ||
          !Number.isFinite(Number(draft.speed)) ||
          Number(draft.speed) < 0.5 ||
          Number(draft.speed) > 2)
      )
        issues.speed = 'Speed must be between 0.5 and 2.';
      if (
        baseline &&
        (draft.provider.trim() !== baseline.provider ||
          (draft.baseUrl.trim() || null) !== (baseline.baseUrl?.trim() || null)) &&
        (!draft.replacing || !draft.apiKey.trim())
      )
        issues.apiKey = 'Enter a new API key when changing the provider or base URL.';
    }
    setErrors(issues);
    setStatus('');
    if (Object.keys(issues).length) return;
    const options = { ...baseline?.options };
    if (kind === 'stt') {
      delete options.language;
      delete options.sttTransport;
      if (draft.language.trim()) options.language = draft.language.trim();
      if (
        draft.provider === 'openai' &&
        (draft.sttTransport === 'realtime' || draft.sttTransport === 'rest')
      )
        options.sttTransport = draft.sttTransport;
    } else {
      delete options.voice;
      if (draft.voice) options.voice = draft.voice;
      options.speed = Number(draft.speed);
    }
    const value: SpeechEndpointDraft = {
      provider: draft.provider.trim(),
      model: draft.model.trim(),
      baseUrl: draft.baseUrl.trim() || null,
      options,
      ...(draft.replacing && draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
    };
    const attempt = revision.current;
    busy.current = true;
    setPending(action === 'test' ? 'test' : 'save');
    try {
      if (action === 'test') {
        const result = await onTest(value);
        if (revision.current !== attempt) return;
        setStatus(
          kind === 'tts'
            ? `Connection successful. ${result.voices?.length ?? 0} voices available.`
            : 'Connection successful.',
        );
        if (result.voices) setTestedChoices({ voices: result.voices, status: 'ready' });
      } else {
        const saved = await onSave(action === 'clear' ? { clear: true } : value);
        if (revision.current !== attempt) return;
        setBaseline(saved);
        setDraft(editEndpoint(saved, providers[0]?.id ?? ''));
        setTestedChoices(undefined);
        setStatus(
          action === 'clear'
            ? 'Configuration cleared. Speech is disabled for this endpoint.'
            : 'Saved speech settings.',
        );
      }
    } catch (error) {
      if (revision.current === attempt)
        setErrors({ ...onErrorFields?.(error), form: errorMessage(error) });
    } finally {
      busy.current = false;
      setPending(null);
    }
  }
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(editEndpoint(baseline, providers[0]?.id ?? ''));
  // The host catalog belongs to `initial`; only an unsaved test can discover another endpoint.
  const initialCatalog =
    initial &&
    draft.provider.trim() === initial.provider &&
    draft.model.trim() === initial.model &&
    (draft.baseUrl.trim() || null) === (initial.baseUrl?.trim() || null)
      ? choices
      : undefined;
  return (
    <form
      ref={form}
      className={className}
      data-flow-voice-endpoint-form={kind}
      aria-label={kind === 'stt' ? 'Dictation endpoint' : 'Read-aloud endpoint'}
      aria-busy={pending !== null}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit('save');
      }}
    >
      {baseline?.validationError && <p role="alert">{baseline.validationError}</p>}
      <fieldset disabled={pending === 'save'}>
        <legend>{kind === 'stt' ? 'Speech-to-text' : 'Text-to-speech'}</legend>
        <Wrapper id={`${id}-provider`} label="Provider" error={errors.provider}>
          <Select
            id={`${id}-provider`}
            value={draft.provider}
            aria-invalid={!!errors.provider}
            aria-describedby={errors.provider ? `${id}-provider-error` : undefined}
            onChange={(event) => update({ provider: event.target.value })}
          >
            {!providers.some((provider) => provider.id === draft.provider) && (
              <option value={draft.provider}>{draft.provider || 'Choose a provider'}</option>
            )}
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </Select>
        </Wrapper>
        {field('model', 'Model', {
          value: draft.model,
          maxLength: 200,
          onChange: (event) => update({ model: event.target.value }),
        })}
        {field(
          'baseUrl',
          'Base URL (optional)',
          {
            value: draft.baseUrl,
            type: 'url',
            onChange: (event) => update({ baseUrl: event.target.value }),
          },
          'Any endpoint speaking that provider’s protocol. Leave blank for the provider’s default endpoint.',
        )}
        {baseline?.keyHint && <p>Saved key: {baseline.keyHint}</p>}
        {baseline?.keyHint && (
          <Button
            type="button"
            data-flow-voice-action={draft.replacing ? 'cancel-key-replacement' : 'replace-key'}
            aria-invalid={!draft.replacing && !!errors.apiKey}
            aria-describedby={!draft.replacing && errors.apiKey ? `${id}-apiKey-error` : undefined}
            onClick={() => update({ replacing: !draft.replacing, apiKey: '' })}
          >
            {draft.replacing ? 'Cancel replacement' : 'Replace key'}
          </Button>
        )}
        {draft.replacing &&
          field(
            'apiKey',
            'API key',
            {
              type: 'password',
              autoComplete: 'new-password',
              value: draft.apiKey,
              onChange: (event) => update({ apiKey: event.target.value }),
            },
            'Write-only. Saved keys are never displayed. A new API key is required when changing the provider or base URL; otherwise leaving this blank preserves the saved key.',
          )}
        {!draft.replacing && errors.apiKey && (
          <p id={`${id}-apiKey-error`} role="alert">
            {errors.apiKey}
          </p>
        )}
        {baseline && <p>To remove the saved key, clear this configuration below.</p>}
        {kind === 'stt' ? (
          <>
            {field(
              'language',
              'Default language (optional)',
              {
                value: draft.language,
                maxLength: 64,
                onChange: (event) => update({ language: event.target.value }),
              },
              'Language code, for example en or fr. Leave blank for automatic detection.',
            )}
            {draft.provider === 'openai' && (
              <Wrapper
                id={`${id}-transport`}
                label="Connection"
                description="Automatic chooses the connection; Live streams dictation, while REST transcribes after pauses."
              >
                <Select
                  id={`${id}-transport`}
                  aria-describedby={`${id}-transport-description`}
                  value={draft.sttTransport}
                  onChange={(event) => update({ sttTransport: event.target.value })}
                >
                  <option value="">Automatic</option>
                  <option value="realtime">Live (realtime)</option>
                  <option value="rest">REST (transcribe after pauses)</option>
                </Select>
              </Wrapper>
            )}
          </>
        ) : (
          <>
            <VoiceSelect
              value={draft.voice}
              onChange={(voice) => update({ voice })}
              choices={testedChoices ?? initialCatalog ?? { voices: [], status: 'ready' }}
              slots={slots}
              label="Default voice"
            />
            {field(
              'speed',
              'Default speed',
              {
                type: 'number',
                min: 0.5,
                max: 2,
                step: 0.1,
                value: draft.speed,
                onChange: (event) => update({ speed: event.target.value }),
              },
              '0.5–2× normal speed',
            )}
          </>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert">{errors.form ?? 'Check the highlighted fields before saving.'}</p>
        )}
        <p role="status">{status}</p>
        <Button
          type="button"
          data-flow-voice-action="test"
          disabled={pending !== null}
          onClick={() => void submit('test')}
        >
          {pending === 'test' ? 'Testing…' : (labels?.test ?? 'Test connection')}
        </Button>
        <Button type="submit" data-flow-voice-action="save" disabled={pending !== null || !dirty}>
          {pending === 'save'
            ? 'Saving…'
            : (labels?.save ?? `Save ${kind === 'stt' ? 'speech-to-text' : 'text-to-speech'}`)}
        </Button>
        <Button
          type="button"
          data-flow-voice-action="reset"
          disabled={pending !== null || !dirty}
          onClick={reset}
        >
          {labels?.reset ?? 'Reset'}
        </Button>
        {baseline && (
          <Button
            type="button"
            data-flow-voice-action="clear"
            disabled={pending !== null}
            onClick={() => void submit('clear')}
          >
            {labels?.clear ?? 'Disable and clear configuration'}
          </Button>
        )}
      </fieldset>
    </form>
  );
}
