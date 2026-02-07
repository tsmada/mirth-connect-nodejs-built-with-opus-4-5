/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/SimpleLineBatchAdaptor.java
 *
 * Purpose: Splits raw messages on a configurable delimiter (default: newline)
 *
 * Key behaviors:
 * - Splits input string by delimiter into an array of sub-messages
 * - Filters out empty strings after splitting
 * - getMessage() returns next sub-message or null when exhausted
 * - getBatchSequenceId() returns 1-based index of current message
 */

import type { BatchAdaptor } from './BatchAdaptor.js';

export class SimpleLineBatchAdaptor implements BatchAdaptor {
  private messages: string[];
  private index: number = 0;
  private sequenceId: number = 0;

  constructor(rawMessage: string, delimiter: string = '\n') {
    this.messages = rawMessage.split(delimiter).filter((line) => line.length > 0);
  }

  async getMessage(): Promise<string | null> {
    if (this.index >= this.messages.length) {
      return null;
    }
    this.sequenceId = this.index + 1;
    return this.messages[this.index++]!;
  }

  getBatchSequenceId(): number {
    return this.sequenceId;
  }

  isBatchComplete(): boolean {
    return this.index >= this.messages.length;
  }

  cleanup(): void {
    this.messages = [];
    this.index = 0;
    this.sequenceId = 0;
  }
}
