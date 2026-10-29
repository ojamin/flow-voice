/** Release ownership only after normal send succeeds; retain it on a failed send. */
export async function submitWithBinding(submit, pending) {
    try {
        await submit();
        pending?.release();
    }
    catch (error) {
        pending?.failed?.();
        throw error;
    }
}
//# sourceMappingURL=submission.js.map