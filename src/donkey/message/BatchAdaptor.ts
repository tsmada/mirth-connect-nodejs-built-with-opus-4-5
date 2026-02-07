/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/BatchAdaptor.java
 *
 * Purpose: Interface for splitting a single raw message into multiple sub-messages
 *
 * Key behaviors:
 * - getMessage() returns the next sub-message or null when exhausted
 * - getBatchSequenceId() returns the 1-based position of the current message
 * - isBatchComplete() indicates whether all messages have been consumed
 * - cleanup() releases any resources held by the adaptor
 */

export interface BatchAdaptor {
  getMessage(): Promise<string | null>;
  getBatchSequenceId(): number;
  isBatchComplete(): boolean;
  cleanup(): void;
}

export interface BatchAdaptorFactory {
  createBatchAdaptor(rawMessage: string): BatchAdaptor;
}
