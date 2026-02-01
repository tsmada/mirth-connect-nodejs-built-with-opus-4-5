/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/Status.java
 *
 * Purpose: Message status codes used throughout the message pipeline
 *
 * Key behaviors to replicate:
 * - Match Java enum values exactly
 * - Single character database representation
 */

/**
 * Message status codes matching Mirth Connect Java implementation.
 * These are stored as single characters in the database.
 */
export enum Status {
  /** Message received but not yet processed */
  RECEIVED = 'R',

  /** Message was filtered out by a filter step */
  FILTERED = 'F',

  /** Message was transformed successfully */
  TRANSFORMED = 'T',

  /** Message was sent to destination successfully */
  SENT = 'S',

  /** Message is queued for later delivery */
  QUEUED = 'Q',

  /** Message processing encountered an error */
  ERROR = 'E',

  /** Message is pending (waiting for response) */
  PENDING = 'P',
}

/**
 * Status descriptions for display purposes
 */
export const STATUS_DESCRIPTIONS: Record<Status, string> = {
  [Status.RECEIVED]: 'Received',
  [Status.FILTERED]: 'Filtered',
  [Status.TRANSFORMED]: 'Transformed',
  [Status.SENT]: 'Sent',
  [Status.QUEUED]: 'Queued',
  [Status.ERROR]: 'Error',
  [Status.PENDING]: 'Pending',
};

/**
 * Check if a status represents a completed/final state
 */
export function isFinalStatus(status: Status): boolean {
  return status === Status.SENT || status === Status.FILTERED || status === Status.ERROR;
}

/**
 * Parse a status character from database to Status enum
 */
export function parseStatus(char: string): Status {
  const status = Object.values(Status).find((s) => s === char);
  if (status == null) {
    throw new Error(`Unknown status character: ${char}`);
  }
  return status;
}
