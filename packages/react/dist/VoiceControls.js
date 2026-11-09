import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from 'react';
import { useVoiceMode } from './voice.js';
import { errorMessage } from './controls.js';
import { VoiceSelect } from './VoiceSelect.js';
export function VoiceControls({ mode, player, conversation, voice, disabled, labels, slots, className, renderOptions, }) {
    const state = useVoiceMode(mode);
    const [open, setOpen] = useState(false);
    const [error, setError] = useState('');
    const id = useId();
    const trigger = useRef(null);
    const generation = useRef(0);
    useEffect(() => {
        generation.current++;
        setOpen(false);
        setError('');
        return () => {
            generation.current++;
        };
    }, [conversation, mode, player]);
    const Button = slots?.Button ?? 'button';
    const Input = slots?.Input ?? 'input';
    const unavailable = disabled || conversation === null;
    const on = state.enabled && (state.scope === 'on-screen' || state.chatId === conversation);
    const content = (_jsxs("div", { id: id, "data-flow-voice-options": "", children: [_jsxs("fieldset", { disabled: unavailable, children: [_jsx("legend", { children: "Voice scope" }), ['one-chat', 'on-screen'].map((scope) => (_jsxs("label", { children: [_jsx(Input, { type: "radio", name: `${id}-scope`, value: scope, checked: state.scope === scope, onChange: () => mode.setScope(scope) }), scope === 'one-chat'
                                ? (labels?.oneChat ?? 'One chat')
                                : (labels?.onScreen ?? 'Chat on screen')] }, scope)))] }), _jsx(VoiceSelect, { ...voice, slots: voice.slots ?? slots, disabled: unavailable || voice.disabled, defaultLabel: voice.defaultLabel ?? 'Account default' })] }));
    const triggerProps = {
        'data-flow-voice-action': 'voice-options',
        type: 'button',
        disabled: unavailable,
        'aria-label': labels?.options ?? 'Voice options',
        'aria-expanded': open,
        'aria-controls': id,
        onClick: () => setOpen(!open),
        children: labels?.options ?? 'Voice options',
    };
    return (_jsxs("div", { className: className, "data-flow-voice-controls": "", "data-flow-voice-active": on, children: [_jsx(Button, { "data-flow-voice-action": "voice", type: "button", disabled: unavailable, "aria-pressed": on, onClick: () => {
                    if (conversation === null)
                        return;
                    setError('');
                    const attempt = ++generation.current;
                    void player.unlock().catch((error) => {
                        if (attempt === generation.current)
                            setError(errorMessage(error));
                    });
                    mode.toggle(conversation);
                }, children: labels?.voice ?? 'Voice' }), renderOptions ? (renderOptions({ triggerProps, content, open, onOpenChange: setOpen })) : (_jsxs(_Fragment, { children: [_jsx(Button, { ...triggerProps, ref: trigger }), open && (_jsx("div", { onKeyDown: (event) => {
                            if (event.key === 'Escape') {
                                setOpen(false);
                                trigger.current?.focus();
                            }
                        }, children: content }))] })), error && _jsx("span", { role: "alert", children: error })] }));
}
//# sourceMappingURL=VoiceControls.js.map