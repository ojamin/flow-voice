import { describe, expect, it } from 'vitest';
import {
  BoundedQueue,
  authHeaders,
  endpoint,
  linkedAbort,
  openSpeechSocket,
  jsonFrame,
} from './transport.js';
import { localServer } from './test-servers.js';
import { normalizeSpeechError } from './errors.js';

describe('shared speech transports', () => {
  it('caps byte admission before connect and rejects non-JSON/binary protocol frames', async () => {
    const fixture = await localServer({});
    try {
      const socket = openSpeechSocket({
        url: fixture.url.replace('http:', 'ws:'),
        signal: new AbortController().signal,
        maxBufferedBytes: 8,
      });
      socket.send(new Uint8Array(6));
      expect(() => socket.send(new Uint8Array(4))).toThrow('limit');
      const iterator = socket.messages[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({ code: 'limit_exceeded' });
      socket.close();
      expect(() => jsonFrame({ binary: true, data: new Uint8Array(2) })).toThrow('provider');
      expect(() => jsonFrame({ binary: false, data: new TextEncoder().encode('[]') })).toThrow(
        'provider',
      );
    } finally {
      await fixture.close();
    }
  });
  it('bounds queues without dropping admitted values and cleans up on return', async () => {
    let returned = false;
    const queue = new BoundedQueue<number>(1, () => {
      returned = true;
    });
    queue.push(1);
    expect(() => queue.push(2)).toThrow('limit');
    const iterator = queue[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: 1 });
    await iterator.return(undefined);
    expect(returned).toBe(true);
  });
  it('returns before the first pull and preserves the first failure across cleanup', async () => {
    let returned = 0;
    const queue = new BoundedQueue<number>(1, () => {
      returned++;
    });
    await queue[Symbol.asyncIterator]().return(undefined);
    expect(returned).toBe(1);
    const failed = new BoundedQueue<number>();
    failed.close(new Error('first failure'));
    failed.close();
    await expect(failed[Symbol.asyncIterator]().next()).rejects.toThrow('first failure');
  });
  it('preserves endpoint prefixes and optional bearer auth', () => {
    expect(endpoint('https://example.test/custom/v1/', 'audio/speech').href).toBe(
      'https://example.test/custom/v1/audio/speech',
    );
    expect(authHeaders()).toEqual({});
    expect(authHeaders('secret')).toEqual({ Authorization: 'Bearer secret' });
  });
  it('links aborts and redacts every upstream message', () => {
    const source = new AbortController();
    const link = linkedAbort(source.signal);
    source.abort();
    expect(link.controller.signal.aborted).toBe(true);
    link.dispose();
    expect(normalizeSpeechError({ status: 401, message: 'secret URL' })).toEqual({
      code: 'unauthorized',
      message: 'Speech provider authentication failed.',
      retryable: false,
    });
    expect(normalizeSpeechError(new Error('secret')).message).not.toContain('secret');
  });
});
