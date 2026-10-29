import { expect, it } from 'vitest';
import { TTS_REPLY_INSTRUCTION } from './index.js';

it('exports the short lowercase per-message Voice instruction', () => {
  expect(TTS_REPLY_INSTRUCTION).toBe('Voice is on: wrap the parts of your reply meant to be spoken in <tts>…</tts> tags.');
});
