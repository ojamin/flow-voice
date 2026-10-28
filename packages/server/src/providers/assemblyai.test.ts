import type { SpeechErrorCode } from '@flow-voice/core';
import { speechError, normalizeSpeechError } from '../errors.js';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { createAssemblyAIAdapters } from './assemblyai.js';

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});
const format = { encoding: 'pcm_s16le' as const, sampleRate: 16000 as const, channels: 1 as const };
async function fixture(begin = true) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  cleanups.push(async () => {
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const baseUrl = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const connected = once(server, 'connection');
  const controller = new AbortController();
  const { stt } = createAssemblyAIAdapters({
    provider: 'assemblyai',
    model: 'universal-streaming-english',
    apiKey: 'test-secret',
    baseUrl,
  });
  const session = stt.open({ format, signal: controller.signal });
  const [socket, request] = await connected;
  if (begin) socket.send(JSON.stringify({ type: 'Begin', id: 'test' }));
  return { socket, request, session, controller };
}
function turn(text: string, end = false, formatted = false, order = 0) {
  return JSON.stringify({
    type: 'Turn',
    transcript: text,
    end_of_turn: end,
    turn_is_formatted: formatted,
    turn_order: order,
  });
}

describe('AssemblyAI Universal Streaming v3', () => {
  it('uses exact v3 authentication and parameters, sends 100ms PCM and flushes formatted final before termination', async () => {
    const { socket, request, session } = await fixture();
    const url = new URL(request.url, 'http://local');
    expect(url.pathname).toBe('/v3/ws');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      sample_rate: '16000',
      encoding: 'pcm_s16le',
      format_turns: 'true',
      speech_model: 'universal-streaming-english',
    });
    expect(request.headers.authorization).toBe('test-secret');
    const received = once(socket, 'message');
    session.write(new Uint8Array(640).fill(1)); // 20ms capture frames
    session.write(new Uint8Array(640).fill(2));
    session.write(new Uint8Array(640).fill(3));
    session.write(new Uint8Array(640).fill(4));
    session.write(new Uint8Array(640).fill(5));
    const [pcm, binary] = await received;
    expect(binary).toBe(true);
    expect(pcm.length).toBe(3200);
    expect([...pcm.subarray(0, 640)]).toEqual([...new Uint8Array(640).fill(1)]);
    expect([...pcm.subarray(2560)]).toEqual([...new Uint8Array(640).fill(5)]);
    const events = session.events[Symbol.asyncIterator]();
    socket.send(JSON.stringify({ type: 'Begin', id: 'test' }));
    socket.send(turn('hel'));
    expect((await events.next()).value).toEqual({ type: 'partial', revision: 1, text: 'hel' });
    socket.send(turn('hello', true));
    expect((await events.next()).value).toEqual({ type: 'partial', revision: 2, text: 'hello' });
    socket.on('message', (data: Buffer, isBinary: boolean) => {
      expect(isBinary).toBe(false);
      expect(JSON.parse(data.toString())).toEqual({ type: 'Terminate' });
      socket.send(turn('Hello.', true, true));
      socket.send(turn('Hello.', true, true)); // no duplicate formatted final
      socket.send(JSON.stringify({ type: 'Termination', audio_duration_seconds: 0.1 }));
    });
    const ending = session.end();
    expect((await events.next()).value).toEqual({ type: 'final', mode: 'append', text: 'Hello.' });
    expect((await events.next()).value).toEqual({ type: 'ended', reason: 'stopped' });
    await ending;
    expect((await events.next()).done).toBe(true);
  });

  it('waits for Begin before sending pre-admitted audio or Terminate', async () => {
    const { socket, session } = await fixture(false);
    const messages: { data: Buffer; binary: boolean }[] = [];
    socket.on('message', (data: Buffer, binary: boolean) => {
      messages.push({ data, binary });
      if (!binary) socket.send(JSON.stringify({ type: 'Termination' }));
    });
    session.write(new Uint8Array(3200).fill(7));
    const ending = session.end();
    const pong = once(socket, 'pong');
    socket.ping();
    await pong;
    expect(messages).toEqual([]);
    socket.send(JSON.stringify({ type: 'Begin', id: 'test' }));
    await ending;
    expect(messages.map((message) => message.binary)).toEqual([true, false]);
    expect(messages[0]!.data).toEqual(Buffer.alloc(3200, 7));
    expect(JSON.parse(messages[1]!.data.toString())).toEqual({ type: 'Terminate' });
  });

  it('pads only a short final PCM tail to the 50ms minimum, before Terminate', async () => {
    const { socket, session } = await fixture();
    const messages: { data: Buffer; binary: boolean }[] = [];
    socket.on('message', (data: Buffer, binary: boolean) => {
      messages.push({ data, binary });
      if (!binary) socket.send(JSON.stringify({ type: 'Termination' }));
    });
    session.write(new Uint8Array([1, 2, 3, 4]));
    await session.end();
    expect(messages).toHaveLength(2);
    expect(messages[0]!.binary).toBe(true);
    expect(messages[0]!.data.length).toBe(1600);
    expect([...messages[0]!.data.subarray(0, 6)]).toEqual([1, 2, 3, 4, 0, 0]);
    expect(JSON.parse(messages[1]!.data.toString())).toEqual({ type: 'Terminate' });
  });

  it('commits an unformatted final if Termination arrives without its formatted update', async () => {
    const { socket, session } = await fixture();
    socket.on('message', () => {
      socket.send(turn('last words', true));
      socket.send(JSON.stringify({ type: 'Termination' }));
    });
    const ending = session.end();
    expect(await collect(session.events)).toEqual([
      { type: 'partial', revision: 1, text: 'last words' },
      { type: 'final', mode: 'append', text: 'last words' },
      { type: 'ended', reason: 'stopped' },
    ]);
    await ending;
  });

  it('does not promote interim speech on unexpected close', async () => {
    const { socket, session } = await fixture();
    socket.send(turn('not final'));
    socket.close(1011, 'private diagnostic test-secret');
    const events = await collect(session.events);
    expect(events).toEqual([
      { type: 'partial', revision: 1, text: 'not final' },
      {
        type: 'error',
        ...normalizeSpeechError(speechError('provider_error')),
      },
      { type: 'ended', reason: 'error' },
    ]);
  });

  it.each([
    [1008, 'unauthorized'],
    [3008, 'limit_exceeded'],
    [3007, 'invalid_message'],
  ])('maps close code %s without exposing the reason', async (code, expected) => {
    const { socket, session } = await fixture();
    socket.close(code, 'test-secret private diagnostic');
    expect(await collect(session.events)).toEqual([
      {
        type: 'error',
        code: expected,
        message: speechError(expected as SpeechErrorCode).message,
        retryable: false,
      },
      { type: 'ended', reason: 'error' },
    ]);
  });

  it('maps the documented rate-limit Error frame separately from other 1008 closures', async () => {
    const { socket, session } = await fixture();
    socket.send(
      JSON.stringify({
        type: 'Error',
        error_code: 1008,
        error: 'Unauthorized Connection: Too many concurrent sessions',
      }),
    );
    expect(await collect(session.events)).toEqual([
      {
        type: 'error',
        ...normalizeSpeechError(speechError('rate_limited')),
      },
      { type: 'ended', reason: 'error' },
    ]);
  });

  it('cancels active sessions and discards queued transcripts without Terminate', async () => {
    const { socket, session, controller } = await fixture();
    const controls: string[] = [];
    socket.on('message', (data: Buffer) => controls.push(data.toString()));
    const closed = once(socket, 'close');
    controller.abort();
    await session.end();
    await closed;
    expect(controls).toEqual([]);
    expect(await collect(session.events)).toEqual([{ type: 'ended', reason: 'cancelled' }]);
  });

  it('rejects unsupported language steering instead of silently ignoring it', () => {
    const { stt } = createAssemblyAIAdapters({
      provider: 'assemblyai',
      model: 'universal-streaming-english',
      apiKey: 'key',
    });
    expect(() =>
      stt.open({ format, language: 'fr', signal: new AbortController().signal }),
    ).toThrow(expect.objectContaining({ code: 'unsupported' }));
  });
});
