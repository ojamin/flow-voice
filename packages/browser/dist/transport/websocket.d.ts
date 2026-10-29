import type { DictationTransport } from '../index.js';
export declare function createWebSocketDictationTransport(options: {
    url: string;
    protocols?: string[];
    maxBufferedBytes?: number;
}): DictationTransport;
