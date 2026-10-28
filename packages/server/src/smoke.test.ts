import { expect, it } from 'vitest';
import { runSmoke } from './smoke.js';
it('does not contact a provider when no explicit environment key is present', async () => {
  await expect(runSmoke({})).resolves.toBeUndefined();
});
