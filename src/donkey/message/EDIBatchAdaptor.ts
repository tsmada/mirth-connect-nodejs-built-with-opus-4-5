/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/edi/EDIBatchAdaptor.java
 *
 * Purpose: Splits multi-interchange EDI/X12 messages on ISA segment boundaries
 *
 * Key behaviors:
 * - Each ISA...IEA envelope is treated as one batch message
 * - Detects element delimiter from ISA position 3 (standard X12 convention)
 * - Falls back to treating entire message as single message if no ISA found
 * - Follows same async iterator pattern as HL7BatchAdaptor
 */

import type { BatchAdaptor, BatchAdaptorFactory } from './BatchAdaptor.js';

export class EDIBatchAdaptor implements BatchAdaptor {
  private messages: string[];
  private index: number = 0;
  private sequenceId: number = 0;

  constructor(rawMessage: string) {
    this.messages = this.splitInterchanges(rawMessage);
  }

  private splitInterchanges(raw: string): string[] {
    if (!raw || raw.trim().length === 0) {
      return [];
    }

    const interchanges: string[] = [];

    // Split on ISA segment boundaries using a lookahead so ISA is kept with each part.
    // The element delimiter follows ISA immediately (position 3), commonly '*' or '|'.
    const isaPattern = /(?=ISA[^A-Za-z0-9])/g;
    const parts = raw.split(isaPattern).filter(part => part.trim().length > 0);

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.startsWith('ISA')) {
        interchanges.push(trimmed);
      }
    }

    // If no ISA segments found, treat entire message as a single message
    if (interchanges.length === 0 && raw.trim().length > 0) {
      interchanges.push(raw.trim());
    }

    return interchanges;
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

export class EDIBatchAdaptorFactory implements BatchAdaptorFactory {
  createBatchAdaptor(rawMessage: string): EDIBatchAdaptor {
    return new EDIBatchAdaptor(rawMessage);
  }
}
