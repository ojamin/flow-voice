import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { useCallSession } from './voice.js';
/** Pocket-safe screen cover, not an OS lock or a guarantee of background recording.
 * Native modal dialog supplies focus containment and makes the rest of the document inert. */
export function CallScreenLock({ call, className }) {
    const state = useCallSession(call);
    const [locked, setLocked] = useState(false);
    const drag = useRef(null);
    const resetDrag = () => {
        const previous = drag.current;
        drag.current = null;
        if (!previous)
            return;
        previous.thumb.style.transform = '';
        if (previous.thumb.hasPointerCapture?.(previous.id))
            previous.thumb.releasePointerCapture(previous.id);
    };
    useEffect(() => {
        setLocked(false);
        resetDrag();
    }, [call, state.status]);
    if (state.status !== 'active')
        return null;
    return _jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: className, "data-flow-voice-action": "lock-call-screen", onClick: () => setLocked(true), children: "Lock call screen" }), locked && _jsx("dialog", { "aria-label": "Call screen locked", "aria-modal": "true", "data-flow-voice-call-lock": "", ref: (dialog) => {
                    if (!dialog)
                        return;
                    dialog.showModal();
                    return () => { resetDrag(); dialog.close(); };
                }, onCancel: (event) => event.preventDefault(), onClick: (event) => { event.preventDefault(); event.stopPropagation(); }, onPointerDownCapture: (event) => {
                    if (!event.isPrimary)
                        resetDrag();
                }, style: {
                    position: 'fixed', inset: 0, margin: 0, padding: 0, border: 0,
                    width: '100vw', height: '100dvh', maxWidth: 'none', maxHeight: 'none',
                    background: '#000', color: '#fff', touchAction: 'none', userSelect: 'none',
                }, children: _jsxs("div", { style: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }, children: [_jsx("p", { children: "Call continues. Slide to unlock." }), _jsx("div", { style: { width: 'min(320px, 80vw)', height: 56, borderRadius: 28, background: '#333' }, children: _jsx("button", { type: "button", "aria-label": "Unlock call screen", autoFocus: true, style: { width: 56, height: 56, borderRadius: '50%', touchAction: 'none' }, onPointerDown: (event) => {
                                    if (!event.isPrimary || event.button !== 0 || drag.current)
                                        return;
                                    event.preventDefault();
                                    const thumb = event.currentTarget;
                                    const distance = thumb.parentElement.getBoundingClientRect().width - thumb.getBoundingClientRect().width;
                                    if (distance <= 0)
                                        return;
                                    drag.current = { id: event.pointerId, start: event.clientX, distance, travel: 0, thumb };
                                    thumb.setPointerCapture(event.pointerId);
                                }, onPointerMove: (event) => {
                                    const current = drag.current;
                                    if (!current || current.id !== event.pointerId)
                                        return;
                                    event.preventDefault();
                                    const travel = Math.max(0, Math.min(current.distance, event.clientX - current.start));
                                    current.travel = Math.max(current.travel, travel);
                                    current.thumb.style.transform = `translateX(${travel}px)`;
                                }, onPointerUp: (event) => {
                                    const current = drag.current;
                                    if (!current || current.id !== event.pointerId)
                                        return;
                                    event.preventDefault();
                                    const unlock = current.travel >= current.distance * 0.9 &&
                                        event.clientX - current.start >= current.distance * 0.9;
                                    resetDrag();
                                    if (unlock)
                                        setLocked(false);
                                }, onPointerCancel: resetDrag, onLostPointerCapture: resetDrag, onClick: (event) => {
                                    // Keyboard and assistive technology activate with detail=0; pointer taps never unlock.
                                    if (event.detail === 0)
                                        setLocked(false);
                                }, children: "\u2192" }) }), _jsx("p", { children: "Keyboard or assistive technology: activate \u201CUnlock call screen\u201D." })] }) })] });
}
//# sourceMappingURL=CallScreenLock.js.map