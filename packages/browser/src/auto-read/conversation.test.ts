import { describe, expect, it } from 'vitest';
import { createAutoReader, createConversationMessages } from '../index.js';
import type { ConversationReply, SpeechMessage, SpeechPlayer } from '../index.js';

const reply = (id: string, ordinal: number, markdown: string, complete = true): ConversationReply => ({
  id,
  markdown,
  own: false,
  complete,
  ordinal,
});

/** The real auto-reader over the adapter, recording what it hands the player. */
function narrator(enabled = true) {
  const messages = createConversationMessages();
  const spoken: string[] = [];
  let stops = 0;
  const player = {
    append: (message: SpeechMessage) =>
      spoken.push(...message.sections.map((section) => section.text)),
    stop: () => {
      stops++;
    },
  } as unknown as SpeechPlayer;
  const start = (route: string, history: readonly ConversationReply[]) => {
    messages.update(route, history, true);
    return createAutoReader({ player, messages, enabled, routeIdentity: route });
  };
  return { messages, spoken, stops: () => stops, start };
}

describe('conversation replies as auto-read arrivals', () => {
  it('accepts authoritative events without a hydration publisher, excluding replay and other audiences', () => {
    const n = narrator();
    n.start('chat:a', []);
    const publish = (conversation: string, id: string, source: 'live' | 'replay' | 'history') =>
      n.messages.publish({ conversation, source, message: reply(id, 1, '<tts>Hello.</tts>') });
    publish('chat:b', 'other', 'live');
    publish('chat:a', 'replay', 'replay');
    publish('chat:a', 'replay', 'live');
    publish('chat:a', 'old', 'history');
    publish('chat:a', 'fresh', 'live');
    publish('chat:a', 'fresh', 'live');
    expect(n.spoken).toEqual(['Hello.']);
  });

  it('compares the first refresh to a loaded baseline without update or a shadow history', () => {
    const n = narrator();
    n.messages.setConversation('agent:a');
    createAutoReader({ player: {
      append: (message: SpeechMessage) => n.spoken.push(...message.sections.map((s) => s.text)),
      stop() {},
    } as unknown as SpeechPlayer, messages: n.messages, enabled: true });
    const baseline = [reply('old', 5, '<tts>Old.</tts>')];
    const finish = n.messages.beforeRefresh('agent:a', baseline, true);
    const rows = [reply('page', 2, '<tts>Page.</tts>'), ...baseline, reply('new', 6, '<tts>New.</tts>')];
    finish(rows);
    finish(rows);
    expect(n.spoken).toEqual(['New.']);
    expect(n.messages.getSnapshot()).toEqual([]);
  });

  it.each([undefined, false] as const)('does not narrate missing baseline or disconnected refresh (%s)', (mode) => {
    const n = narrator();
    n.start('agent:a', []);
    const rows = [reply('old', 1, '<tts>History.</tts>')];
    n.messages.beforeRefresh('agent:a', mode === undefined ? undefined : [], mode !== false)(rows);
    n.messages.beforeRefresh('agent:a', rows, true)(rows);
    expect(n.spoken).toEqual([]);
  });

  it('fences stale refreshes after switching away and back or invalidating the audience', () => {
    const n = narrator();
    n.start('agent:a', []);
    const switched = n.messages.beforeRefresh('agent:a', [], true);
    n.messages.setConversation('agent:b');
    n.messages.setConversation('agent:a');
    switched([reply('stale', 1, '<tts>Stale.</tts>')]);
    const invalidated = n.messages.beforeRefresh('agent:a', [], true);
    n.messages.invalidatePending();
    invalidated([reply('stale2', 2, '<tts>Stale.</tts>')]);
    n.messages.beforeRefresh('agent:a', [], true)([reply('new', 3, '<tts>New.</tts>')]);
    expect(n.spoken).toEqual(['New.']);
  });

  it('does not replay disabled arrivals when enabled, including a later completion', () => {
    const n = narrator(false);
    const reader = n.start('agent:a', []);
    const stream = (id: string, markdown: string, complete: boolean) =>
      n.messages.publish({ conversation: 'agent:a', source: 'live', message: reply(id, 1, markdown, complete) });
    stream('disabled', '<tts>Old', false);
    reader.setEnabled(true);
    stream('disabled', '<tts>Old.</tts>', true);
    stream('new', '<tts>First.</tts><tts>Sec', false);
    stream('new', '<tts>First.</tts><tts>Second.</tts>', true);
    stream('new', '<tts>First.</tts><tts>Second.</tts>', true);
    expect(n.spoken).toEqual(['First.', 'Second.']);
  });

  it('handles overlapping refresh completions once and in either completion order', () => {
    for (const reverse of [false, true]) {
      const n = narrator();
      n.start('agent:a', []);
      const rows = [reply('new', 1, '<tts>New.</tts>')];
      const first = n.messages.beforeRefresh('agent:a', [], true);
      const second = n.messages.beforeRefresh('agent:a', [], true);
      for (const finish of reverse ? [second, first] : [first, second]) finish(rows);
      expect(n.spoken).toEqual(['New.']);
    }
  });

  it('emits growing sections of a reply already partial in the pre-refresh baseline', () => {
    const n = narrator();
    n.start('agent:a', []);
    const initial = reply('new', 1, '<tts>First.</tts><tts>Sec', false);
    n.messages.publish({ conversation: 'agent:a', source: 'live', message: initial });
    n.messages.beforeRefresh('agent:a', [initial], true)([
      reply('new', 1, '<tts>First.</tts><tts>Second.</tts>', true),
    ]);
    expect(n.spoken).toEqual(['First.', 'Second.']);
  });

  it('does not turn an edited or partial historical baseline into first-refresh speech', () => {
    const n = narrator();
    n.start('agent:a', []);
    const before = [reply('old', 1, '<tts>Old.</tts>'), reply('partial', 2, '<tts>Not live', false)];
    n.messages.beforeRefresh('agent:a', before, true)([
      reply('old', 1, '<tts>Edited old.</tts>'),
      reply('partial', 2, '<tts>Not live either.</tts>', true),
      reply('new', 3, '<tts>New.</tts>'),
    ]);
    expect(n.spoken).toEqual(['New.']);
  });

  it('keeps instances isolated across authenticated query clients', () => {
    const a = narrator();
    const b = narrator();
    a.start('chat:a', []);
    b.start('chat:a', []);
    a.messages.publish({ conversation: 'chat:a', source: 'live', message: reply('new', 1, '<tts>A.</tts>') });
    expect(a.spoken).toEqual(['A.']);
    expect(b.spoken).toEqual([]);
  });
  it('never narrates replies already in the thread when Voice starts', () => {
    const n = narrator();
    n.start('thread-a', [reply('a1', 1, '<tts>Old news.</tts>')]);
    n.messages.update('thread-a', [reply('a1', 1, '<tts>Old news.</tts> More old text.')], true);
    expect(n.spoken).toEqual([]);
  });

  it('reads only closed <tts> sections of a streaming reply, once each', () => {
    const n = narrator();
    n.start('thread-a', []);
    const stream = (markdown: string, complete = false) =>
      n.messages.update('thread-a', [reply('a1', 1, markdown, complete)], true);
    stream('Working <tts>First part');
    expect(n.spoken).toEqual([]);
    stream('Working <tts>First part.</tts> code `x` <tts>Second');
    expect(n.spoken).toEqual(['First part.']);
    stream('Working <tts>First part.</tts> code `x` <tts>Second part.</tts>', true);
    // A resync delivering the same text again is not new speech.
    stream('Working <tts>First part.</tts> code `x` <tts>Second part.</tts>', true);
    expect(n.spoken).toEqual(['First part.', 'Second part.']);
  });

  it('treats replies paged in behind the newest one as history', () => {
    const n = narrator();
    n.start('thread-a', [reply('a5', 5, 'Latest.')]);
    n.messages.update(
      'thread-a',
      [reply('a2', 2, '<tts>Older page.</tts>'), reply('a5', 5, 'Latest.')],
      true,
    );
    expect(n.spoken).toEqual([]);
    n.messages.update(
      'thread-a',
      [
        reply('a2', 2, '<tts>Older page.</tts>'),
        reply('a5', 5, 'Latest.'),
        reply('a6', 6, '<tts>Fresh.</tts>'),
      ],
      true,
    );
    expect(n.spoken).toEqual(['Fresh.']);
  });

  it('counts everything as history while the thread loads or is disconnected', () => {
    const n = narrator();
    n.start('thread-a', []);
    n.messages.update('thread-a', [reply('a1', 1, '<tts>Loaded on reconnect.</tts>')], false);
    n.messages.update('thread-a', [reply('a1', 1, '<tts>Loaded on reconnect.</tts>')], true);
    expect(n.spoken).toEqual([]);
  });

  it('reports a new conversation\'s replies as history, not as arrivals', () => {
    const n = narrator();
    const reader = n.start('thread-a', []);
    n.messages.update('thread-b', [reply('b9', 9, '<tts>Another thread.</tts>')], true);
    reader.setRouteIdentity('thread-b');
    expect(n.spoken).toEqual([]);
    expect(n.stops()).toBe(1);
    n.messages.update(
      'thread-b',
      [reply('b9', 9, '<tts>Another thread.</tts>'), reply('b10', 10, '<tts>New here.</tts>')],
      true,
    );
    expect(n.spoken).toEqual(['New here.']);
  });

  it('stays silent while Voice is off and does not catch up when it turns on', () => {
    const n = narrator(false);
    const reader = n.start('thread-a', []);
    n.messages.update('thread-a', [reply('a1', 1, '<tts>Missed.</tts>')], true);
    reader.setEnabled(true);
    n.messages.update('thread-a', [reply('a1', 1, '<tts>Missed.</tts> Still missed.')], true);
    expect(n.spoken).toEqual([]);
  });
});
