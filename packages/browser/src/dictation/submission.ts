import type { SubmissionBinding } from '../index.js';

/** Release ownership only after normal send succeeds; retain it on a failed send. */
export async function submitWithBinding(submit: () => void | Promise<void>, pending?: SubmissionBinding) {
  try {
    await submit();
    pending?.release();
  } catch (error) {
    pending?.failed?.();
    throw error;
  }
}
