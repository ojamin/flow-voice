import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from 'react';
import { useDictation } from './dictation.js';
/** Unstyled native controls: hosts supply their button/focus/disabled visual language. */
export function MicButton({ controller, children, renderStatus, showLevel = false, statusClassName, disabled, ...props }) {
    const snapshot = useDictation(controller);
    const id = useId();
    const active = snapshot.status === 'listening' || snapshot.status === 'connecting';
    const busy = snapshot.status === 'connecting' || snapshot.status === 'finalizing';
    const label = snapshot.status === 'listening'
        ? 'Stop dictation'
        : snapshot.status === 'connecting'
            ? 'Cancel dictation'
            : snapshot.status === 'finalizing'
                ? 'Finishing dictation'
                : 'Start dictation';
    const status = snapshot.error?.message ??
        (snapshot.status === 'listening'
            ? 'Listening'
            : snapshot.status === 'connecting'
                ? 'Connecting microphone'
                : snapshot.status === 'finalizing'
                    ? 'Finishing transcription'
                    : 'Microphone off');
    const activate = () => {
        const action = snapshot.status === 'connecting'
            ? controller.cancel()
            : snapshot.status === 'listening'
                ? controller.finish()
                : controller.start();
        void action.catch(() => { }); // The external store exposes the accessible error state.
    };
    return (_jsxs(_Fragment, { children: [_jsx("button", { ...props, type: "button", "aria-label": props['aria-label'] ?? label, "aria-pressed": active, "aria-busy": busy, "aria-describedby": [props['aria-describedby'], id].filter(Boolean).join(' '), disabled: disabled || snapshot.status === 'finalizing', onClick: activate, children: typeof children === 'function' ? children(snapshot) : (children ?? label) }), _jsx("span", { id: id, role: "status", "aria-live": "polite", className: statusClassName, children: renderStatus ? renderStatus(snapshot) : status }), showLevel && snapshot.status === 'listening' && (_jsx("meter", { min: 0, max: 1, value: snapshot.rms, "aria-label": "Microphone level" })), snapshot.countdownMs !== null && (_jsxs("span", { className: statusClassName, children: [_jsxs("span", { role: "status", "aria-live": "polite", children: ["Sending in ", Math.ceil(snapshot.countdownMs / 1000), " seconds"] }), ' ', _jsx("button", { type: "button", onClick: () => controller.cancelAutoSend(), children: "Cancel automatic send" })] }))] }));
}
//# sourceMappingURL=MicButton.js.map