import { decodeSttServerMessage, encodeSttClientMessage } from '@flow-voice/core';
export function createWebSocketDictationTransport(options) {
    let socket;
    let detach = () => { };
    return {
        connect(handlers) {
            if (socket)
                return Promise.reject(new Error('Transport already connected'));
            return new Promise((resolve, reject) => {
                let opened = false;
                const ws = new WebSocket(options.url, options.protocols);
                socket = ws;
                ws.binaryType = 'arraybuffer';
                const abort = () => {
                    ws.close();
                    reject(new DOMException('Cancelled', 'AbortError'));
                };
                detach = () => handlers.signal.removeEventListener('abort', abort);
                handlers.signal.addEventListener('abort', abort, { once: true });
                if (handlers.signal.aborted) {
                    abort();
                    return;
                }
                ws.onopen = () => {
                    opened = true;
                    resolve();
                };
                ws.onmessage = (event) => {
                    try {
                        handlers.onMessage(decodeSttServerMessage(event.data));
                    }
                    catch {
                        handlers.onError({
                            code: 'invalid_message',
                            message: 'The speech server sent an invalid response.',
                        });
                        ws.close();
                    }
                };
                ws.onerror = () => {
                    const error = {
                        code: 'transport_error',
                        message: 'The speech connection failed.',
                    };
                    handlers.onError(error);
                    reject(error);
                };
                ws.onclose = () => {
                    detach();
                    if (!handlers.signal.aborted)
                        handlers.onError({ code: 'transport_error', message: 'The speech connection closed.' });
                    if (!opened)
                        reject(new Error('Speech connection closed before opening'));
                };
            });
        },
        async send(message) {
            if (!socket || socket.readyState !== WebSocket.OPEN)
                throw new Error('Speech connection is not open');
            const encoded = encodeSttClientMessage(message);
            const bytes = typeof encoded === 'string'
                ? new TextEncoder().encode(encoded).byteLength
                : encoded.byteLength;
            if (socket.bufferedAmount + bytes > (options.maxBufferedBytes ?? 320000))
                throw new Error('Speech connection audio buffer is full');
            socket.send(typeof encoded === 'string' ? encoded : new Uint8Array(encoded));
        },
        close() {
            detach();
            if (socket) {
                socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
                socket.close();
                socket = undefined;
            }
        },
    };
}
//# sourceMappingURL=websocket.js.map