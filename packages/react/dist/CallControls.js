import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useCallSession } from './voice.js';
export function CallControls({ call, disabled, labels, slots, className }) {
    const state = useCallSession(call);
    const [error, setError] = useState('');
    const [pending, setPending] = useState(false);
    const starting = useRef(false);
    const generation = useRef(0);
    useEffect(() => {
        generation.current++;
        starting.current = false;
        setPending(false);
        setError('');
        return () => {
            generation.current++;
        };
    }, [call]);
    const Button = slots?.Button ?? 'button';
    return (_jsxs("div", { className: className, "data-flow-voice-call": "", "aria-busy": pending, role: "group", "aria-label": "Call controls", children: [_jsx(Button, { "data-flow-voice-action": "call", type: "button", disabled: disabled || pending || state.status === 'active', "aria-pressed": state.status === 'active', onClick: () => {
                    if (starting.current)
                        return;
                    starting.current = true;
                    setPending(true);
                    setError('');
                    const attempt = ++generation.current;
                    void (async () => {
                        try {
                            await call.start();
                        }
                        catch {
                            if (attempt === generation.current) {
                                call.end();
                                setError('Could not start the call. Check microphone and audio access, then try again.');
                            }
                        }
                        finally {
                            if (attempt === generation.current) {
                                starting.current = false;
                                setPending(false);
                            }
                        }
                    })();
                }, children: pending ? 'Starting call…' : (labels?.call ?? 'Call') }), state.status === 'active' && (_jsxs(_Fragment, { children: [_jsx(Button, { "data-flow-voice-action": state.muted ? 'unmute' : 'mute', type: "button", disabled: pending || (disabled && state.muted), "aria-pressed": state.muted, onClick: () => call.setMuted(!state.muted), children: state.muted ? (labels?.unmute ?? 'Unmute') : (labels?.mute ?? 'Mute') }), _jsx(Button, { "data-flow-voice-action": "end-call", type: "button", disabled: false, onClick: () => {
                            generation.current++;
                            starting.current = false;
                            setPending(false);
                            call.end();
                            setError('');
                        }, children: labels?.end ?? 'End call' })] })), (error || state.failed) && (_jsx("span", { role: "alert", children: error ||
                    'The call ended after repeated microphone or speech service failures. Try again.' }))] }));
}
//# sourceMappingURL=CallControls.js.map