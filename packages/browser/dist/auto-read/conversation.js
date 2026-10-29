/** Feeds the auto-reader from the conversation's data (never from mounted or virtualized rows),
 * telling new replies and growing streams from history, pages loaded behind and reconnects. */
export function createConversationMessages() {
    const listeners = new Set();
    let conversation = null;
    let epoch = 0;
    let snapshot = [];
    let known = new Map();
    // Only live-owned partials may grow across a refresh. A partial already in the first
    // loaded baseline is history too; it must not become speech just because it changed.
    // Retain the latest published text so overlapping refreshes cannot rewind a live stream.
    const streaming = new Map();
    /** Newest ordinal seen: an unknown reply behind it was paged in, not just written. */
    let frontier = -1;
    const publish = ({ conversation: target, ...arrival }) => {
        if (target !== conversation)
            return;
        if (arrival.source === 'live' && !arrival.message.complete)
            streaming.set(arrival.message.id, arrival.message.markdown);
        else
            streaming.delete(arrival.message.id);
        for (const listener of listeners)
            listener(arrival);
    };
    const setConversation = (next) => {
        if (next === conversation)
            return;
        conversation = next;
        epoch++;
        snapshot = [];
        known = new Map();
        frontier = -1;
        streaming.clear();
    };
    return {
        publish,
        setConversation,
        invalidatePending() { epoch++; streaming.clear(); },
        beforeRefresh(target, baseline, live) {
            const audience = epoch;
            // Copy the pre-invalidation facts: callers may replace or mutate their cache later.
            const before = new Map(baseline?.map((reply) => [reply.id, {
                    markdown: reply.markdown, complete: reply.complete,
                }]));
            const watermark = Math.max(-1, ...(baseline?.map((reply) => reply.ordinal) ?? []));
            let consumed = false;
            return (replies) => {
                if (consumed)
                    return;
                consumed = true;
                if (audience !== epoch || target !== conversation)
                    return;
                for (const { ordinal, ...message } of [...replies].sort((a, b) => a.ordinal - b.ordinal)) {
                    const published = streaming.get(message.id);
                    if (published !== undefined && published.length > message.markdown.length &&
                        published.startsWith(message.markdown))
                        continue;
                    const previous = before.get(message.id);
                    if (previous?.markdown === message.markdown && previous.complete === message.complete)
                        continue;
                    publish({ conversation: target, message,
                        source: live && baseline !== undefined &&
                            (previous === undefined ? ordinal > watermark : streaming.has(message.id))
                            ? 'live' : 'history' });
                }
            };
        },
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        update(nextConversation, replies, live) {
            const fresh = nextConversation !== conversation;
            setConversation(nextConversation);
            const previousFrontier = frontier;
            const next = new Map();
            const arrivals = [];
            for (const reply of replies) {
                frontier = Math.max(frontier, reply.ordinal);
                const before = known.get(reply.id);
                next.set(reply.id, { markdown: reply.markdown, complete: reply.complete });
                if (before?.markdown === reply.markdown && before.complete === reply.complete)
                    continue;
                const source = live && !fresh && (before !== undefined || reply.ordinal > previousFrontier)
                    ? 'live'
                    : 'history';
                const { ordinal: _ordinal, ...message } = reply;
                arrivals.push({ message, source });
            }
            known = next;
            snapshot = replies.map(({ ordinal: _ordinal, ...message }) => message);
            for (const arrival of arrivals)
                publish({ conversation: nextConversation, ...arrival });
        },
    };
}
//# sourceMappingURL=conversation.js.map