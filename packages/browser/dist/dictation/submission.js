/** Release ownership only after normal send succeeds; retain it on a failed send. */
export async function submitWithBinding(submit, pending, admit) {
    if (admit && !admit())
        return;
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