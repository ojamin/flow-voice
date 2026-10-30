import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from 'react';
import { Field, errorMessage } from './controls.js';
import { VoiceSelect } from './VoiceSelect.js';
export function SpeechPreferencesForm({ initial, stt, tts, choices, speakerNames = [], onSave, labels, slots, className, }) {
    const [baseline, setBaseline] = useState(initial);
    const [draft, setDraft] = useState(initial);
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [saved, setSaved] = useState(false);
    const [pending, setPending] = useState(false);
    const busy = useRef(false);
    const nameInput = useRef(null);
    const revision = useRef(0);
    const id = useId();
    useEffect(() => {
        revision.current++;
        setBaseline(initial);
        setDraft(initial);
        setError('');
        setSaved(false);
        setName('');
    }, [initial]);
    useEffect(() => () => {
        revision.current++;
    }, []);
    const Input = slots?.Input ?? 'input';
    const Button = slots?.Button ?? 'button';
    const Wrapper = slots?.Field ?? Field;
    const update = (patch) => {
        setDraft((value) => ({ ...value, ...patch }));
        setSaved(false);
        setError('');
    };
    const speaker = (name, patch) => update({
        speakerVoices: { ...draft.speakerVoices, [name]: { ...draft.speakerVoices[name], ...patch } },
    });
    const field = (key, label, props, description) => (_jsx(Wrapper, { id: `${id}-${key}`, label: label, description: description, children: _jsx(Input, { type: "text", ...props, id: `${id}-${key}`, "aria-describedby": description ? `${id}-${key}-description` : undefined }) }, key));
    async function save() {
        if (busy.current)
            return;
        if (stt && draft.sendOnWord && !draft.keyword.trim()) {
            setError('Enter a send keyword.');
            return;
        }
        busy.current = true;
        setPending(true);
        setError('');
        setSaved(false);
        const attempt = revision.current;
        const value = {
            ...draft,
            keyword: draft.keyword.trim(),
            language: draft.language?.trim() || undefined,
        };
        try {
            const result = await onSave(value);
            if (attempt === revision.current) {
                setBaseline(result);
                setDraft(result);
                setSaved(true);
            }
        }
        catch (error) {
            if (attempt === revision.current)
                setError(errorMessage(error));
        }
        finally {
            busy.current = false;
            setPending(false);
        }
    }
    const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
    return (_jsx("form", { className: className, "data-flow-voice-preferences-form": "", "aria-label": "Voice preferences", "aria-busy": pending, onSubmit: (event) => {
            event.preventDefault();
            void save();
        }, children: _jsxs("fieldset", { disabled: pending, children: [_jsx("legend", { children: "Your voice preferences" }), tts ? (_jsx(VoiceSelect, { value: draft.voice, onChange: (voice) => update({ voice }), choices: choices, slots: slots, label: "Your voice", defaultLabel: "Account default" })) : (_jsx("p", { children: "Read-aloud is not configured for this account." })), stt ? (_jsxs(_Fragment, { children: [field('pause', 'Send when I pause', {
                            type: 'checkbox',
                            checked: draft.sendAfterPause,
                            onChange: (event) => update({ sendAfterPause: event.target.checked }),
                        }, 'Send dictated text after a pause. A visible countdown can be cancelled before sending.'), field('silence', 'Silence delay (seconds)', {
                            type: 'number',
                            required: true,
                            min: 0.3,
                            max: 60,
                            step: 0.1,
                            value: draft.silenceMs / 1000,
                            onChange: (event) => update({ silenceMs: Math.round(Number(event.target.value) * 1000) }),
                        }, 'How long to wait without new words (0.3–60 seconds).'), field('word', 'Send when I say a word', {
                            type: 'checkbox',
                            checked: draft.sendOnWord,
                            onChange: (event) => update({ sendOnWord: event.target.checked }),
                        }, 'Say this word or phrase at the end to send immediately. The phrase is removed from the message.'), field('keyword', 'Send keyword', {
                            value: draft.keyword,
                            maxLength: 40,
                            required: draft.sendOnWord,
                            onChange: (event) => update({ keyword: event.target.value }),
                        }), field('stop', 'Turn the microphone off after sending', {
                            type: 'checkbox',
                            checked: draft.stopAfterSend,
                            onChange: (event) => update({ stopAfterSend: event.target.checked }),
                        }), field('language', 'Language (optional)', {
                            value: draft.language ?? '',
                            maxLength: 64,
                            onChange: (event) => update({ language: event.target.value }),
                        }, 'Language code such as en or fr. Leave blank to use the account default.')] })) : (_jsx("p", { children: "Dictation is not configured for this account." })), tts && (_jsxs("fieldset", { children: [_jsx("legend", { children: labels?.speakers ?? 'Speaker voices' }), Object.entries(draft.speakerVoices).map(([name, preference], index) => (_jsxs("fieldset", { children: [_jsx("legend", { children: name }), _jsx(VoiceSelect, { value: preference.voice, onChange: (voice) => speaker(name, { voice }), choices: choices, slots: slots, label: `Voice for ${name}`, defaultLabel: "Account default" }), field(`speed-${index}`, `Speed for ${name}`, {
                                    type: 'number',
                                    min: 0.5,
                                    max: 2,
                                    step: 0.1,
                                    placeholder: 'Account default',
                                    value: preference.speed ?? '',
                                    onChange: (event) => speaker(name, {
                                        speed: event.target.value === '' ? undefined : Number(event.target.value),
                                    }),
                                }), field(`muted-${index}`, `Mute ${name}`, {
                                    type: 'checkbox',
                                    checked: preference.muted ?? false,
                                    onChange: (event) => speaker(name, { muted: event.target.checked }),
                                }), _jsx(Button, { "data-flow-voice-action": "remove-speaker", type: "button", "aria-label": `Remove ${name} override`, onClick: () => {
                                        const next = { ...draft.speakerVoices };
                                        delete next[name];
                                        update({ speakerVoices: next });
                                        nameInput.current?.focus();
                                    }, children: "Remove override" })] }, name))), field('name', labels?.speakerName ?? 'Speaker name', {
                            value: name,
                            ref: nameInput,
                            maxLength: 200,
                            list: `${id}-names`,
                            onChange: (event) => {
                                setName(event.target.value);
                                setError('');
                            },
                        }), _jsx("datalist", { id: `${id}-names`, children: speakerNames.map((name) => (_jsx("option", { value: name }, name))) }), _jsx(Button, { "data-flow-voice-action": "add-speaker", type: "button", disabled: !name.trim() || Object.hasOwn(draft.speakerVoices, name.trim()), onClick: () => {
                                update({ speakerVoices: { ...draft.speakerVoices, [name.trim()]: {} } });
                                setName('');
                                nameInput.current?.focus();
                            }, children: labels?.addSpeaker ?? 'Add speaker' })] })), error && _jsx("p", { role: "alert", children: error }), _jsx(Button, { type: "submit", "data-flow-voice-action": "save", disabled: pending || !dirty || (!stt && !tts), children: pending ? 'Saving…' : (labels?.save ?? 'Save voice preferences') }), _jsx(Button, { "data-flow-voice-action": "reset", type: "button", disabled: pending || !dirty, onClick: () => {
                        setDraft(baseline);
                        setName('');
                        setError('');
                        setSaved(false);
                    }, children: labels?.reset ?? 'Reset' }), _jsx("p", { role: "status", children: saved ? 'Saved to your account.' : '' })] }) }));
}
//# sourceMappingURL=SpeechPreferencesForm.js.map