import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from 'react';
import { validateSpeechEndpointDraft } from '@flow-voice/core';
import { Field, errorMessage } from './controls.js';
import { VoiceSelect } from './VoiceSelect.js';
const editEndpoint = (initial, provider) => ({
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
export function SpeechEndpointForm({ kind, initial, providers, choices, onSave, onTest, onErrorFields, labels, slots, className, }) {
    const [baseline, setBaseline] = useState(initial);
    const [draft, setDraft] = useState(() => editEndpoint(initial, providers[0]?.id ?? ''));
    const [pending, setPending] = useState(null);
    const [errors, setErrors] = useState({});
    const [status, setStatus] = useState('');
    const [testedChoices, setTestedChoices] = useState();
    const busy = useRef(false);
    const form = useRef(null);
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
    useEffect(() => () => {
        revision.current++;
    }, []);
    useEffect(() => {
        if (Object.keys(errors).length)
            form.current?.querySelector('[aria-invalid="true"]')?.focus();
    }, [errors]);
    const id = useId();
    const Input = slots?.Input ?? 'input';
    const Select = slots?.Select ?? 'select';
    const Button = slots?.Button ?? 'button';
    const Wrapper = slots?.Field ?? Field;
    const update = (patch) => {
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
    const field = (name, label, props, description) => (_jsx(Wrapper, { id: `${id}-${name}`, label: label, error: errors[name], description: description, children: _jsx(Input, { type: "text", ...props, id: `${id}-${name}`, "aria-invalid": !!errors[name], "aria-describedby": [
                description ? `${id}-${name}-description` : '',
                errors[name] ? `${id}-${name}-error` : '',
            ]
                .filter(Boolean)
                .join(' ') || undefined }) }, name));
    async function submit(action) {
        if (busy.current)
            return;
        const issues = {};
        const options = { ...baseline?.options };
        if (kind === 'stt') {
            delete options.language;
            delete options.sttTransport;
            if (draft.language.trim())
                options.language = draft.language.trim();
            if (draft.provider === 'openai' &&
                (draft.sttTransport === 'realtime' || draft.sttTransport === 'rest'))
                options.sttTransport = draft.sttTransport;
        }
        else {
            delete options.voice;
            if (draft.voice)
                options.voice = draft.voice;
            options.speed = Number(draft.speed);
        }
        let value = {
            provider: draft.provider.trim(),
            model: draft.model.trim(),
            baseUrl: draft.baseUrl.trim() || null,
            options,
            ...(draft.replacing && draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        };
        if (action !== 'clear') {
            // The same normalization and key-rebinding rule the host applies on test and save.
            const checked = validateSpeechEndpointDraft(value, baseline);
            if (checked.ok)
                value = checked.value;
            else
                for (const issue of checked.issues) {
                    const field = issue.path[0] === 'options' && issue.path[1] === 'speed'
                        ? 'speed' : issue.path[0] ?? 'form';
                    issues[field] ??= issue.message;
                }
        }
        setErrors(issues);
        setStatus('');
        if (Object.keys(issues).length)
            return;
        const attempt = revision.current;
        busy.current = true;
        setPending(action === 'test' ? 'test' : 'save');
        try {
            if (action === 'test') {
                const result = await onTest(value);
                if (revision.current !== attempt)
                    return;
                setStatus(kind === 'tts'
                    ? `Connection successful. ${result.voices?.length ?? 0} voices available.`
                    : 'Connection successful.');
                if (result.voices)
                    setTestedChoices({ voices: result.voices, status: 'ready' });
            }
            else {
                const saved = await onSave(action === 'clear' ? { clear: true } : value);
                if (revision.current !== attempt)
                    return;
                setBaseline(saved);
                setDraft(editEndpoint(saved, providers[0]?.id ?? ''));
                setTestedChoices(undefined);
                setStatus(action === 'clear'
                    ? 'Configuration cleared. Speech is disabled for this endpoint.'
                    : 'Saved speech settings.');
            }
        }
        catch (error) {
            if (revision.current === attempt)
                setErrors({ ...onErrorFields?.(error), form: errorMessage(error) });
        }
        finally {
            busy.current = false;
            setPending(null);
        }
    }
    const dirty = JSON.stringify(draft) !== JSON.stringify(editEndpoint(baseline, providers[0]?.id ?? ''));
    // The host catalog belongs to `initial`; only an unsaved test can discover another endpoint.
    const initialCatalog = initial &&
        draft.provider.trim() === initial.provider &&
        draft.model.trim() === initial.model &&
        (draft.baseUrl.trim() || null) === (initial.baseUrl?.trim() || null)
        ? choices
        : undefined;
    return (_jsxs("form", { ref: form, className: className, "data-flow-voice-endpoint-form": kind, "aria-label": kind === 'stt' ? 'Dictation endpoint' : 'Read-aloud endpoint', "aria-busy": pending !== null, noValidate: true, onSubmit: (event) => {
            event.preventDefault();
            void submit('save');
        }, children: [baseline?.validationError && _jsx("p", { role: "alert", children: baseline.validationError }), _jsxs("fieldset", { disabled: pending === 'save', children: [_jsx("legend", { children: kind === 'stt' ? 'Speech-to-text' : 'Text-to-speech' }), _jsx(Wrapper, { id: `${id}-provider`, label: "Provider", error: errors.provider, children: _jsxs(Select, { id: `${id}-provider`, value: draft.provider, "aria-invalid": !!errors.provider, "aria-describedby": errors.provider ? `${id}-provider-error` : undefined, onChange: (event) => update({ provider: event.target.value }), children: [!providers.some((provider) => provider.id === draft.provider) && (_jsx("option", { value: draft.provider, children: draft.provider || 'Choose a provider' })), providers.map((provider) => (_jsx("option", { value: provider.id, children: provider.name }, provider.id)))] }) }), field('model', 'Model', {
                        value: draft.model,
                        maxLength: 200,
                        onChange: (event) => update({ model: event.target.value }),
                    }), field('baseUrl', 'Base URL (optional)', {
                        value: draft.baseUrl,
                        type: 'url',
                        onChange: (event) => update({ baseUrl: event.target.value }),
                    }, 'Any endpoint speaking that provider’s protocol. Leave blank for the provider’s default endpoint.'), baseline?.keyHint && _jsxs("p", { children: ["Saved key: ", baseline.keyHint] }), baseline?.keyHint && (_jsx(Button, { type: "button", "data-flow-voice-action": draft.replacing ? 'cancel-key-replacement' : 'replace-key', "aria-invalid": !draft.replacing && !!errors.apiKey, "aria-describedby": !draft.replacing && errors.apiKey ? `${id}-apiKey-error` : undefined, onClick: () => update({ replacing: !draft.replacing, apiKey: '' }), children: draft.replacing ? 'Cancel replacement' : 'Replace key' })), draft.replacing &&
                        field('apiKey', 'API key', {
                            type: 'password',
                            autoComplete: 'new-password',
                            value: draft.apiKey,
                            onChange: (event) => update({ apiKey: event.target.value }),
                        }, 'Write-only. Saved keys are never displayed. A new API key is required when changing the provider or base URL; otherwise leaving this blank preserves the saved key.'), !draft.replacing && errors.apiKey && (_jsx("p", { id: `${id}-apiKey-error`, role: "alert", children: errors.apiKey })), baseline && _jsx("p", { children: "To remove the saved key, clear this configuration below." }), kind === 'stt' ? (_jsxs(_Fragment, { children: [field('language', 'Default language (optional)', {
                                value: draft.language,
                                maxLength: 64,
                                onChange: (event) => update({ language: event.target.value }),
                            }, 'Language code, for example en or fr. Leave blank for automatic detection.'), draft.provider === 'openai' && (_jsx(Wrapper, { id: `${id}-transport`, label: "Connection", description: "Automatic chooses the connection; Live streams dictation, while REST transcribes after pauses.", children: _jsxs(Select, { id: `${id}-transport`, "aria-describedby": `${id}-transport-description`, value: draft.sttTransport, onChange: (event) => update({ sttTransport: event.target.value }), children: [_jsx("option", { value: "", children: "Automatic" }), _jsx("option", { value: "realtime", children: "Live (realtime)" }), _jsx("option", { value: "rest", children: "REST (transcribe after pauses)" })] }) }))] })) : (_jsxs(_Fragment, { children: [_jsx(VoiceSelect, { value: draft.voice, onChange: (voice) => update({ voice }), choices: testedChoices ?? initialCatalog ?? { voices: [], status: 'ready' }, slots: slots, label: "Default voice" }), field('speed', 'Default speed', {
                                type: 'number',
                                min: 0.5,
                                max: 2,
                                step: 0.1,
                                value: draft.speed,
                                onChange: (event) => update({ speed: event.target.value }),
                            }, '0.5–2× normal speed')] })), Object.keys(errors).length > 0 && (_jsx("p", { role: "alert", children: errors.form ?? 'Check the highlighted fields before saving.' })), _jsx("p", { role: "status", children: status }), _jsx(Button, { type: "button", "data-flow-voice-action": "test", disabled: pending !== null, onClick: () => void submit('test'), children: pending === 'test' ? 'Testing…' : (labels?.test ?? 'Test connection') }), _jsx(Button, { type: "submit", "data-flow-voice-action": "save", disabled: pending !== null || !dirty, children: pending === 'save'
                            ? 'Saving…'
                            : (labels?.save ?? `Save ${kind === 'stt' ? 'speech-to-text' : 'text-to-speech'}`) }), _jsx(Button, { type: "button", "data-flow-voice-action": "reset", disabled: pending !== null || !dirty, onClick: reset, children: labels?.reset ?? 'Reset' }), baseline && (_jsx(Button, { type: "button", "data-flow-voice-action": "clear", disabled: pending !== null, onClick: () => void submit('clear'), children: labels?.clear ?? 'Disable and clear configuration' }))] })] }));
}
//# sourceMappingURL=SpeechEndpointForm.js.map