/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/HL7BatchAdaptor.java
 *
 * Purpose: Splits HL7 batch messages on MSH segment boundaries
 *
 * Key behaviors:
 * - Splits on lines starting with "MSH" (the message header segment)
 * - Skips FHS/BHS/BTS/FTS batch envelope segments
 * - Each MSH starts a new message; subsequent non-MSH lines are appended
 * - Uses \r as the segment separator in output (HL7 standard)
 */

import type { BatchAdaptor } from './BatchAdaptor.js';

const BATCH_ENVELOPE_SEGMENTS = new Set(['FHS', 'BHS', 'BTS', 'FTS']);

export class HL7BatchAdaptor implements BatchAdaptor {
  private messages: string[];
  private index: number = 0;
  private sequenceId: number = 0;

  constructor(rawMessage: string) {
    this.messages = this.splitBatch(rawMessage);
  }

  private splitBatch(rawMessage: string): string[] {
    if (!rawMessage || rawMessage.trim().length === 0) {
      return [];
    }

    // Normalize line endings to \n for splitting, then re-join with \r
    const lines = rawMessage.split(/\r\n|\r|\n/);
    const result: string[] = [];
    let currentSegments: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      // Extract segment name (first 3 chars before the field separator)
      const segName = trimmed.substring(0, 3);

      // Skip batch envelope segments
      if (BATCH_ENVELOPE_SEGMENTS.has(segName)) {
        continue;
      }

      if (segName === 'MSH') {
        // Flush the previous message if any
        if (currentSegments.length > 0) {
          result.push(currentSegments.join('\r'));
        }
        currentSegments = [trimmed];
      } else {
        // Append to current message (handles segments that follow MSH)
        if (currentSegments.length > 0) {
          currentSegments.push(trimmed);
        }
        // Lines before first MSH are ignored (shouldn't happen in valid HL7)
      }
    }

    // Flush last message
    if (currentSegments.length > 0) {
      result.push(currentSegments.join('\r'));
    }

    return result;
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
