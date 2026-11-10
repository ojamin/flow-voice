/** Whether the chat's Voice button shows on, from a snapshot. React hosts (especially with
 * the React Compiler) should read through these with `useVoiceMode`'s snapshot so renders
 * depend on it. */
export function isVoiceOnFor(snapshot, chatId) {
    return snapshot.enabled && (snapshot.scope === 'on-screen' || snapshot.chatId === chatId);
}
/** The chat whose new replies are read, from a snapshot. */
export function readingChatOf(snapshot) {
    if (!snapshot.enabled)
        return null;
    return snapshot.scope === 'on-screen' ? snapshot.chatOnScreen : snapshot.chatId;
}
/** Ephemeral host-owned Voice preference. Voice itself never persists; hosts may persist the
 * scope through `onScopeChange` and pass it back as `scope`. */
export function createVoiceMode(options = {}) {
    let snapshot = {
        enabled: false, scope: options.scope ?? 'one-chat', chatId: null, chatOnScreen: null,
    };
    const listeners = new Set();
    const publish = (patch) => {
        const next = { ...snapshot, ...patch };
        if (Object.keys(next).every((key) => next[key] === snapshot[key]))
            return;
        snapshot = next;
        listeners.forEach((listener) => listener());
    };
    const mode = {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        toggle: (chatId) => mode.setEnabled(chatId, !mode.isOnFor(chatId)),
        setEnabled(chatId, enabled) {
            if (snapshot.scope === 'on-screen' || enabled)
                publish({ enabled, chatId });
            else if (snapshot.chatId === chatId)
                publish({ enabled: false });
        },
        setScope(scope) {
            if (scope === snapshot.scope)
                return;
            const chatId = scope === 'one-chat' && snapshot.enabled
                ? snapshot.chatOnScreen ?? snapshot.chatId
                : snapshot.chatId;
            publish({ scope, chatId });
            options.onScopeChange?.(scope);
        },
        setChatOnScreen: (chatOnScreen) => publish({ chatOnScreen }),
        isOnFor: (chatId) => isVoiceOnFor(snapshot, chatId),
        isReadingFor: (chatOnScreen) => snapshot.enabled &&
            (snapshot.scope === 'on-screen' || snapshot.chatId === chatOnScreen),
        readingChat: () => readingChatOf(snapshot),
        enableFor(chatId) {
            const { enabled, chatId: previous } = snapshot;
            mode.setEnabled(chatId, true);
            return () => publish({ enabled, chatId: previous });
        },
    };
    return mode;
}
//# sourceMappingURL=voice-mode.js.map