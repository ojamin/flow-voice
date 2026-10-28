import type { ProviderEndpointConfig } from '@flow-voice/core';
import type { SttAdapter } from '../index.js';
/** Universal Streaming v3, not the deprecated v2 realtime protocol.
 * https://www.assemblyai.com/docs/api-reference/streaming/realtime
 * https://www.assemblyai.com/docs/streaming/common-session-errors-and-closures
 */
export declare function createAssemblyAIAdapters(config: ProviderEndpointConfig): {
    stt: SttAdapter;
};
