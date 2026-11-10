import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { Field } from './controls.js';
import { voiceOptions } from './voice-options.js';
export function VoiceSelect({ value, onChange, choices, disabled, defaultLabel = 'Provider default', label = 'Voice', slots, className, }) {
    const id = useId();
    const Select = slots?.Select ?? 'select';
    const Button = slots?.Button ?? 'button';
    const Wrapper = slots?.Field ?? Field;
    return (_jsxs("div", { className: className, "data-flow-voice-select": "", children: [_jsx(Wrapper, { id: id, label: label, children: _jsx(Select, { id: id, value: value ?? '', disabled: disabled, "aria-describedby": `${id}-status`, onChange: (event) => onChange(event.target.value || undefined), children: voiceOptions(value, choices, defaultLabel).map((option) => (_jsx("option", { value: option.value, disabled: option.disabled, children: option.label }, option.value))) }) }), _jsx("span", { id: `${id}-status`, role: "status", children: choices.status === 'loading'
                    ? 'Loading voices…'
                    : choices.status === 'error'
                        ? 'Could not load voices.'
                        : choices.voices.length === 0
                            ? 'No voices available.'
                            : '' }), choices.status === 'error' && choices.retry && (_jsx(Button, { type: "button", "data-flow-voice-action": "retry-voices", disabled: disabled, onClick: choices.retry, children: "Retry voices" }))] }));
}
//# sourceMappingURL=VoiceSelect.js.map