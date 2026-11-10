export function createPlaybackGate() {
    let holders = 0;
    const listeners = new Set();
    return {
        isMicrophoneActive: () => holders > 0,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        acquireMicrophone() {
            holders++;
            listeners.forEach((listener) => listener());
            let released = false;
            return () => {
                if (!released) {
                    released = true;
                    holders--;
                    listeners.forEach((listener) => listener());
                }
            };
        },
    };
}
//# sourceMappingURL=gate.js.map