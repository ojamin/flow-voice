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
export function PlayerControls({ player, className, children, slots, hideWhenIdle, disabled: allDisabled, labels, }) {
    const snapshot = useSpeechPlayer(player);
    if (children)
        return createElement('div', { className }, children(snapshot, player));
    const active = snapshot.messageId !== null;
    if (hideWhenIdle && snapshot.status === 'idle' && !snapshot.queuedMessages)
        return null;
    const button = (action, label, onClick, disabled = false, text = label) => {
        const props = {
            type: 'button',
            onClick,
            disabled: allDisabled || disabled,
            'aria-label': label,
            'data-flow-voice-action': action,
        };
        return createElement(slots?.Button ?? 'button', props, text);
    };
    const progress = active
        ? `Message ${snapshot.messageId}, section ${(snapshot.sectionOrdinal ?? 0) + 1}. ${snapshot.queuedMessages} message${snapshot.queuedMessages === 1 ? '' : 's'} queued.`
        : 'No speech queued.';
    const status = snapshot.status === 'blocked'
        ? 'Enable audio to hear new messages.'
        : snapshot.status === 'loading'
            ? 'Preparing speech…'
            : snapshot.status === 'paused'
                ? 'Speech paused'
                : snapshot.status === 'error'
                    ? 'Speech stopped.'
                    : snapshot.status === 'idle' ? 'No speech queued.' : 'Reading aloud';
    return createElement('div', {
        className,
        role: 'group',
        'aria-label': 'Speech playback',
        'data-flow-voice-player': '',
        'data-flow-voice-state': snapshot.status,
    }, createElement('span', { role: 'status', 'aria-live': 'polite' }, active ? `${status} ${progress}` : status), snapshot.status === 'blocked'
        ? button('enable-audio', labels?.enableAudio ?? 'Enable audio', () => {
            void player.unlock().catch(() => { }); // Player store owns failure feedback.
        })
        : null, snapshot.status === 'paused' || snapshot.status === 'error'
        ? button('resume', labels?.resume ?? 'Resume speech', () => {
            void player.resume().catch(() => { }); // Player store owns failure feedback.
        }, !active, labels?.resume ?? 'Resume')
        : snapshot.status === 'blocked' ? null : button('pause', labels?.pause ?? 'Pause speech', () => player.pause(), !active, labels?.pause ?? 'Pause'), button('skip-section', labels?.skipSection ?? 'Skip section', () => player.skipSection(), !active), button('skip-reply', labels?.skipReply ?? 'Skip to end of message', () => player.skipToEnd(), !active, labels?.skipReply ?? 'Skip reply'), button('stop', labels?.stop ?? 'Stop speech', () => player.stop(), !active && !snapshot.queuedMessages, labels?.stop ?? 'Stop'), snapshot.error ? createElement('span', { role: 'alert' }, snapshot.error.message) : null);
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