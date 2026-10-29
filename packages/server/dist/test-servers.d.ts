import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type WebSocket } from 'ws';
/** Test-owned loopback fixture: no external requests, no persistent resources. */
export declare function localServer(options: {
    http?: (request: IncomingMessage, response: ServerResponse) => void;
    ws?: (socket: WebSocket, request: IncomingMessage) => void;
}): Promise<{
    url: string;
    close(): Promise<void>;
}>;
export declare function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>>;
export declare function deferred<T = void>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
};
