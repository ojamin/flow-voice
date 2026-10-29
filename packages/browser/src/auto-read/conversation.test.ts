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
