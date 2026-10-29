/** Ephemeral host-owned Voice preference. Never writes to storage. */
export function createVoiceMode(options = {}) {
    let snapshot = {
        enabled: false, scope: options.scope ?? 'one-chat', chatId: null,
    };
    const listeners = new Set();
    const publish = (patch) => {
        snapshot = { ...snapshot, ...patch };
        listeners.forEach((listener) => listener());
    };
    return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        toggle: (chatId) => publish({ enabled: !snapshot.enabled, chatId }),
        setScope: (scope) => publish({ scope }),
        isReadingFor: (chatId) => snapshot.enabled &&
            (snapshot.scope === 'on-screen' || snapshot.chatId === chatId),
    };
}
//# sourceMappingURL=voice-mode.js.map