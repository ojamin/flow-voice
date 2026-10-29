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
  publish(arrival: ConversationArrival): void;
  setConversation(conversation: string | null): void;
  /** Fence pending refreshes, including switch-away-and-back and authorization disposal. */
  invalidatePending(): void;
  beforeRefresh(conversation: string, baseline: readonly ConversationReply[] | undefined,
    live: boolean): (replies: readonly ConversationReply[]) => void;
}

export interface ConversationArrival extends MessageArrival {
  conversation: string;
}

/** Feeds the auto-reader from the conversation's data (never from mounted or virtualized rows),
 * telling new replies and growing streams from history, pages loaded behind and reconnects. */
export function createConversationMessages(): ConversationMessages {
  const listeners = new Set<(arrival: MessageArrival) => void>();
  let conversation: string | null = null;
  let epoch = 0;
  let snapshot: readonly ReadableMessage[] = [];
  let known = new Map<string, { markdown: string; complete: boolean }>();
  // Only live-owned partials may grow across a refresh. A partial already in the first
  // loaded baseline is history too; it must not become speech just because it changed.
  const streaming = new Set<string>();
  /** Newest ordinal seen: an unknown reply behind it was paged in, not just written. */
  let frontier = -1;
  const publish = ({ conversation: target, ...arrival }: ConversationArrival) => {
    if (target !== conversation) return;
    if (arrival.source === 'live' && !arrival.message.complete) streaming.add(arrival.message.id);
    else streaming.delete(arrival.message.id);
    for (const listener of listeners) listener(arrival);
  };
  const setConversation = (next: string | null) => {
    if (next === conversation) return;
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
        if (consumed) return;
        consumed = true;
        if (audience !== epoch || target !== conversation) return;
        for (const { ordinal, ...message } of [...replies].sort((a, b) => a.ordinal - b.ordinal)) {
          const previous = before.get(message.id);
          if (previous?.markdown === message.markdown && previous.complete === message.complete) continue;
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
      for (const arrival of arrivals) publish({ conversation: nextConversation, ...arrival });
    },
  };
}
