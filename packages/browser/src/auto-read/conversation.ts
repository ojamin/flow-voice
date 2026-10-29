import type { MessageAdapter, MessageArrival, ReadableMessage } from '../index.js';

export interface ConversationReply extends ReadableMessage {
  /** The reply's stable position in its conversation (a persisted sequence number, not a
   * render index or timestamp). An unknown reply behind the newest was paged in, not written. */
  readonly ordinal: number;
}

export interface ConversationMessages extends MessageAdapter {
  /** Report the conversation's current replies. `live` is false while it is loading or
   * disconnected; then, and for the first report of each conversation, everything is history. */
  update(conversation: string, replies: readonly ConversationReply[], live: boolean): void;
}

/** Feeds the auto-reader from the conversation's data (never from mounted or virtualized rows),
 * telling new replies and growing streams from history, pages loaded behind and reconnects. */
export function createConversationMessages(): ConversationMessages {
  const listeners = new Set<(arrival: MessageArrival) => void>();
  let conversation: string | undefined;
  let snapshot: readonly ReadableMessage[] = [];
  let known = new Map<string, { markdown: string; complete: boolean }>();
  /** Newest ordinal seen: an unknown reply behind it was paged in, not just written. */
  let frontier = -1;
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(nextConversation, replies, live) {
      const fresh = nextConversation !== conversation;
      if (fresh) {
        conversation = nextConversation;
        known = new Map();
        frontier = -1;
      }
      const previousFrontier = frontier;
      const next = new Map<string, { markdown: string; complete: boolean }>();
      const arrivals: MessageArrival[] = [];
      for (const reply of replies) {
        frontier = Math.max(frontier, reply.ordinal);
        const before = known.get(reply.id);
        next.set(reply.id, { markdown: reply.markdown, complete: reply.complete });
        if (before?.markdown === reply.markdown && before.complete === reply.complete) continue;
        const source =
          live && !fresh && (before !== undefined || reply.ordinal > previousFrontier)
            ? 'live'
            : 'history';
        const { ordinal: _ordinal, ...message } = reply;
        arrivals.push({ message, source });
      }
      known = next;
      snapshot = replies.map(({ ordinal: _ordinal, ...message }) => message);
      for (const arrival of arrivals) for (const listener of listeners) listener(arrival);
    },
  };
}
