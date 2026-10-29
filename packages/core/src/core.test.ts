import { describe, expect, it } from 'vitest';
import {
  createStreamingSpeechExtractor,
  decodeSttClientMessage,
  decodeSttServerMessage,
  displayMarkdown,
  encodeSttClientMessage,
  encodeSttServerMessage,
  matchSendKeyword,
  normalizeKeyword,
  parseTts,
  silenceDecision,
  speechSections,
  speechText,
} from './index.js';

describe('speech wire boundary', () => {
  it('round trips controls, revisioned replacement transcripts, and binary PCM without base64', () => {
    const start = {
      type: 'start',
      version: 1,
      audio: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
    } as const;
    expect(decodeSttClientMessage(encodeSttClientMessage(start))).toEqual(start);
    const audio = new Uint8Array([0, 0, 255, 127]);
    expect(encodeSttClientMessage(decodeSttClientMessage(audio))).toBe(audio);
    expect(decodeSttClientMessage(audio.buffer)).toEqual({ type: 'audio', audio });
    const partial = {
      type: 'partial',
      revision: 3,
      committed: 'hello',
      tentative: ' world',
    } as const;
    expect(decodeSttServerMessage(encodeSttServerMessage(partial))).toEqual(partial);
  });
  it('rejects unsupported rates, versions, channel layouts, malformed/oversize PCM and unknown fields', () => {
    for (const raw of [
      new Uint8Array(),
      new Uint8Array(3),
      new Uint8Array(32002),
      { type: 'audio', audio: [0, 0] },
      '{',
      ' '.repeat(4097),
      { type: 'stop', apiKey: 'secret' },
      { type: 'start', version: 2 },
      {
        type: 'start',
        version: 1,
        audio: { encoding: 'pcm_s16le', sampleRate: 12345, channels: 2 },
      },
    ])
      expect(() => decodeSttClientMessage(raw)).toThrow();
    expect(() =>
      decodeSttServerMessage({ type: 'partial', revision: -1, committed: '', tentative: '' }),
    ).toThrow();
    expect(() =>
      decodeSttServerMessage({ type: 'error', code: 'raw_vendor_error', message: 'x' }),
    ).toThrow();
  });
});

describe('one code-aware tts projection', () => {
  it('unwraps tagged sections and speaks them but not surrounding text', () => {
    const md =
      'before <tts>**Hello** [world](https://example.com)</tts> <tts>more narration</tts> after';
    expect(displayMarkdown(md)).toBe(
      'before **Hello** [world](https://example.com) more narration after',
    );
    expect(speechText(md)).toBe('Hello world\nmore narration');
  });
  it.each([
    '`<tts>literal</tts>`',
    '``<tts>`literal`</tts>``',
    '```html\n<tts>literal</tts>\n```',
    '~~~\n<tts>literal</tts>\n~~~',
    '    <tts>literal</tts>',
  ])('leaves code literal: %s', (md) => {
    expect(displayMarkdown(md)).toBe(md);
    expect(parseTts(md).spans).toEqual([]);
    expect(speechText(md)).toBe('');
  });
  it.each([
    '<tts>unclosed',
    '<tts hidden>x</tts>',
    '</tts>',
    '<tts><tts>x</tts></tts>',
    '<tts invalid>x</tts>',
    '<tts>ok</tts><tts>bad',
  ])('rejects whole malformed document: %s', (md) => {
    expect(parseTts(md).malformed).toBe(true);
    expect(displayMarkdown(md)).toBe(md);
  });
  it('treats unsupported attributes as malformed and reads the whole message as plain text', () => {
    const md = 'before <tts>selected</tts> <tts hidden>also visible</tts> after';
    expect(parseTts(md)).toEqual({ spans: [], malformed: true });
    expect(displayMarkdown(md)).toBe(md);
    expect(speechText(md)).toBe('before selected also visible after');
  });
  it('omits code/images/HTML/tables, keeps link labels and emoji, and bounds all sections', () => {
    const md =
      '# Hello 😀\n\n[Label](https://example.com) `secret` ![image](x)\n\n```\nprivate code\n```\n\n| head |\n| --- |\n| value |\n\n<div>html block</div>\n\nLast sentence.';
    expect(speechText(md)).toBe('Hello 😀\nLabel\nLast sentence.');
    const result = speechSections('First sentence. Second long sentence. Third.', {
      maxTextChars: 24,
      maxSectionChars: 10,
    });
    expect(
      result.every((section, ordinal) => section.ordinal === ordinal && section.text.length <= 10),
    ).toBe(true);
    expect(result.reduce((n, section) => n + section.text.length, 0)).toBeLessThanOrEqual(24);
    expect(() => speechSections('text', { maxSectionChars: 0 })).toThrow();
  });
  it('reads a whole long untagged message, past the per-request synthesis limit', () => {
    const paragraph = 'This sentence belongs to a long reply. '.repeat(40);
    const source = Array.from({ length: 8 }, () => paragraph).join('\n\n');
    const spoken = speechSections(source).reduce((sum, section) => sum + section.text.length, 0);
    expect(source.length).toBeGreaterThan(10_000);
    expect(spoken).toBeGreaterThan(source.length - 400);
  });
  it('preserves escaped tags and does not interpret backticks across paragraph boundaries', () => {
    expect(displayMarkdown('\\<tts>literal\\</tts>')).toBe('\\<tts>literal\\</tts>');
    expect(displayMarkdown('`unclosed\n\n<tts>visible</tts>\n\n`')).toBe(
      '`unclosed\n\nvisible\n\n`',
    );
    expect(speechText('😀😀', { maxTextChars: 3, maxSectionChars: 3 })).toBe('😀');
  });
  it('uses tagged-only semantics even for empty or code-only tags', () => {
    expect(speechText('outside <tts>`code`</tts>')).toBe('');
    expect(speechText('outside <tts></tts>')).toBe('');
  });
  it('emits completed append-only tagged sections once; holds untagged prose until final', () => {
    const stream = createStreamingSpeechExtractor();
    expect(stream.push('prefix <tts>one')).toEqual([]);
    expect(stream.push('prefix <tts>one</tts><tts>tw')).toEqual([{ ordinal: 0, text: 'one' }]);
    expect(stream.push('prefix <tts>one</tts><tts>two</tts>')).toEqual([
      { ordinal: 1, text: 'two' },
    ]);
    expect(stream.push('prefix <tts>one</tts><tts>two</tts>', true)).toEqual([]);
    expect(() => stream.push('replacement')).toThrow();
    const plain = createStreamingSpeechExtractor();
    expect(plain.push('hello')).toEqual([]);
    expect(plain.push('hello world', true)).toEqual([{ ordinal: 0, text: 'hello world' }]);
  });
  it('rejects revisions and exposes a malformed final suffix without replay', () => {
    const stream = createStreamingSpeechExtractor();
    stream.push('<tts>one</tts>');
    expect(() => stream.push('new')).toThrow();
    expect(stream.push('<tts>one</tts><tts>bad', true)).toEqual([]);
    expect(stream.malformed).toBe(true);
  });
});

describe('auto-send pure decisions', () => {
  it('normalizes Unicode/case/space and strips only whole trailing phrases preserving draft', () => {
    expect(normalizeKeyword(' ＳＥＮＤ   Now ')).toBe('send now');
    expect(matchSendKeyword('Keep Case. SEND  now!', 'send now')).toEqual({
      matched: true,
      text: 'Keep Case.',
    });
    expect(matchSendKeyword('resend', 'send').matched).toBe(false);
    expect(matchSendKeyword('send more words', 'send').matched).toBe(false);
    expect(matchSendKeyword('words', '').matched).toBe(false);
    expect(matchSendKeyword('send', 'send')).toEqual({ matched: true, text: '' });
  });
  it('counts from last word, exposes countdown, and never sends empty/cancelled/blocked drafts', () => {
    const input = {
      enabled: true,
      text: 'hello',
      now: 2000,
      lastWordAt: 1000,
      silenceMs: 1500,
      cancelled: false,
      canSubmit: true,
    };
    expect(silenceDecision(input)).toEqual({ send: false, remainingMs: 500 });
    expect(silenceDecision({ ...input, now: 2500 })).toEqual({ send: true, remainingMs: 0 });
    for (const override of [
      { text: '  ' },
      { enabled: false },
      { cancelled: true },
      { canSubmit: false },
    ])
      expect(silenceDecision({ ...input, now: 9999, ...override })).toEqual({
        send: false,
        remainingMs: null,
      });
  });
});
