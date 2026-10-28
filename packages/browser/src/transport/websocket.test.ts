// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createWebSocketDictationTransport } from './websocket.js';
class FakeSocket {
  static OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  binaryType = '';
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onerror?: () => void;
  onclose?: () => void;
  send = vi.fn();
  close = vi.fn();
  static latest: FakeSocket;
  constructor() {
    FakeSocket.latest = this;
  }
}
afterEach(() => vi.unstubAllGlobals());
it('encodes control and raw PCM, decodes revisioned messages, bounds buffers, detaches on close', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const transport = createWebSocketDictationTransport({
    url: 'wss://example.test/speech',
    maxBufferedBytes: 100,
  });
  const onMessage = vi.fn();
  const onError = vi.fn();
  const connected = transport.connect({ signal: new AbortController().signal, onMessage, onError });
  const socket = FakeSocket.latest;
  socket.onopen?.();
  await connected;
  await transport.send({ type: 'stop' });
  await transport.send({ type: 'audio', audio: new Uint8Array([1, 0]) });
  expect(socket.send.mock.calls).toEqual([['{"type":"stop"}'], [new Uint8Array([1, 0])]]);
  socket.onmessage?.({
    data: '{"type":"partial","revision":2,"committed":"hello","tentative":"world"}',
  });
  expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
  socket.bufferedAmount = 100;
  await expect(transport.send({ type: 'stop' })).rejects.toThrow('buffer');
  transport.close();
  expect(socket.onmessage).toBeNull();
  expect(socket.close).toHaveBeenCalled();
});
it('fails closed on malformed server responses', async () => {
  vi.stubGlobal('WebSocket', FakeSocket);
  const transport = createWebSocketDictationTransport({ url: 'wss://example.test' });
  const onError = vi.fn();
  const promise = transport.connect({
    signal: new AbortController().signal,
    onMessage: vi.fn(),
    onError,
  });
  FakeSocket.latest.onopen?.();
  await promise;
  FakeSocket.latest.onmessage?.({ data: '{"type":"partial"}' });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_message' }));
  transport.close();
});
