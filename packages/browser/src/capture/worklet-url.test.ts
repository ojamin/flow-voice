import { expect, it } from 'vitest';
// @ts-expect-error Vite supplies the URL query module, not the TypeScript resolver.
import workletUrl from '@flow-voice/browser/worklet?url';

it('resolves the published worklet URL from source without dist output', () => {
  expect(workletUrl).toMatch(/\/capture\/worklet\.js(?:\?|$)/);
});
