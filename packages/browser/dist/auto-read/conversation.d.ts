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
    beforeRefresh(conversation: string, baseline: readonly ConversationReply[] | undefined, live: boolean): (replies: readonly ConversationReply[]) => void;
}
export interface ConversationArrival extends MessageArrival {
    conversation: string;
}
/** Feeds the auto-reader from the conversation's data (never from mounted or virtualized rows),
 * telling new replies and growing streams from history, pages loaded behind and reconnects. */
export declare function createConversationMessages(): ConversationMessages;
