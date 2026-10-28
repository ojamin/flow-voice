import { createElement, useEffect, useRef, useSyncExternalStore } from 'react';
import { createAutoReader } from '@flow-voice/browser';
export function useSpeechPlayer(player) {
    return useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
}
/** Reader setup is effect-owned (including StrictMode cleanup); callbacks stay current. */
export function useAutoRead(options) {
    const current = useRef(options);
    current.current = options;
    const instance = useRef(null);
    const facade = useRef({
        setEnabled: (value) => instance.current?.setEnabled(value),
        setRouteIdentity: (value) => instance.current?.setRouteIdentity(value),
        dispose: () => instance.current?.dispose(),
    });
    useEffect(() => {
        const reader = createAutoReader({
            ...current.current,
            preferences: (agent) => current.current.preferences?.(agent) ?? {},
            filter: (message) => current.current.filter?.(message) ?? true,
        });
        instance.current = reader;
        return () => {
            reader.dispose();
            instance.current = null;
        };
    }, [options.player, options.messages]);
    useEffect(() => {
        instance.current?.setEnabled(options.enabled);
    }, [options.enabled]);
    useEffect(() => {
        instance.current?.setRouteIdentity(options.routeIdentity);
    }, [options.routeIdentity]);
    return facade.current;
}
export function PlayerControls({ player, className, children }) {
    const snapshot = useSpeechPlayer(player);
    if (children)
        return createElement('div', { className }, children(snapshot, player));
    const active = snapshot.messageId !== null;
    const button = (label, onClick, disabled = false) => createElement('button', { type: 'button', onClick, disabled, 'aria-label': label }, label);
    const progress = active
        ? `Message ${snapshot.messageId}, section ${(snapshot.sectionOrdinal ?? 0) + 1}. ${snapshot.queuedMessages} message${snapshot.queuedMessages === 1 ? '' : 's'} queued.`
        : 'No speech queued.';
    return createElement('div', { className, role: 'group', 'aria-label': 'Speech playback' }, createElement('span', { role: 'status', 'aria-live': 'polite' }, `${snapshot.status}. ${progress}`), snapshot.status === 'blocked'
        ? button('Enable audio', () => {
            void player.unlock();
        })
        : null, snapshot.status === 'paused' || snapshot.status === 'error'
        ? button('Resume speech', () => {
            void player.resume();
        }, !active)
        : button('Pause speech', () => player.pause(), !active || snapshot.status === 'blocked'), button('Skip section', () => player.skipSection(), !active), button('Skip to end of message', () => player.skipToEnd(), !active), button('Stop speech', () => player.stop(), !active && !snapshot.queuedMessages), snapshot.error ? createElement('span', { role: 'alert' }, snapshot.error.message) : null);
}
export function ReadAloudButton({ onRead, player, messageId, disabled, className, children, render, }) {
    // Separate subscribed child keeps the legacy onRead-only button usable without a store.
    if (player)
        return createElement(SubscribedReadButton, { onRead, player, messageId, disabled, className, render }, children);
    return createElement('button', { type: 'button', disabled, className, onClick: onRead, 'aria-label': 'Read message aloud' }, children ?? 'Read aloud');
}
function SubscribedReadButton({ onRead, player, messageId, disabled, className, children, render, }) {
    const snapshot = useSpeechPlayer(player);
    const playing = messageId !== undefined && snapshot.messageId === messageId;
    const label = playing ? 'Stop reading message' : 'Read message aloud';
    const props = {
        type: 'button',
        disabled,
        className,
        'aria-label': label,
        'aria-pressed': playing,
        onClick: () => {
            if (playing)
                player.stop();
            else
                onRead();
        },
    };
    return render
        ? render({ playing, buttonProps: props })
        : createElement('button', props, children ?? (playing ? 'Stop reading' : 'Read aloud'));
}
//# sourceMappingURL=playback.js.map