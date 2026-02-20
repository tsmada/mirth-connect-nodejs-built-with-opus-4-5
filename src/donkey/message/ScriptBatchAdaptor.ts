/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/ScriptBatchAdaptor.java
 *
 * Purpose: Base batch adaptor that splits messages using a user-defined JavaScript batch script.
 *
 * Key behaviors:
 * - Executes a batch script that receives a `reader` object wrapping the raw message content
 * - Each call to getMessage() returns the next sub-message from the script, or null when exhausted
 * - Used by Raw, JSON, and NCPDP data types (which only support JavaScript-based batch splitting)
 *
 * Node.js simplification: Java uses BufferedReader streaming; we pass the full string to the
 * script scope. This matches the existing Node.js adaptor pattern (HL7BatchAdaptor, EDIBatchAdaptor).
 */

import type { BatchAdaptor, BatchAdaptorFactory } from './BatchAdaptor.js';

/**
 * A simple reader interface provided to batch scripts.
 * Wraps the raw message string for line-by-line or full reading.
 */
export interface ScriptBatchReader {
  /** Read the next line, or null when exhausted */
  readLine(): string | null;
  /** Read all remaining content */
  readAll(): string;
  /** Check if there is more content */
  hasMore(): boolean;
  /** Close the reader (no-op for string-backed) */
  close(): void;
}

function createStringReader(content: string): ScriptBatchReader {
  const lines = content.split(/\r?\n/);
  let lineIndex = 0;
  let allRead = false;

  return {
    readLine(): string | null {
      if (allRead || lineIndex >= lines.length) return null;
      return lines[lineIndex++] ?? null;
    },
    readAll(): string {
      if (allRead) return '';
      allRead = true;
      const remaining = lines.slice(lineIndex).join('\n');
      lineIndex = lines.length;
      return remaining;
    },
    hasMore(): boolean {
      return !allRead && lineIndex < lines.length;
    },
    close(): void {
      allRead = true;
    },
  };
}

/**
 * ScriptBatchAdaptor — splits messages using a user-defined batch script function.
 *
 * The script function receives `{ reader, sourceMap }` and should return
 * the next message string, or null/empty when done.
 */
export class ScriptBatchAdaptor implements BatchAdaptor {
  private reader: ScriptBatchReader;
  private batchScript: ((context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null);
  private sourceMap: Map<string, unknown>;
  private sequenceId: number = 0;
  private done: boolean = false;

  constructor(
    rawMessage: string,
    batchScript: (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null,
    sourceMap?: Map<string, unknown>
  ) {
    this.reader = createStringReader(rawMessage);
    this.batchScript = batchScript;
    this.sourceMap = sourceMap ?? new Map();
  }

  async getMessage(): Promise<string | null> {
    if (this.done) return null;

    const result = this.batchScript({
      reader: this.reader,
      sourceMap: this.sourceMap,
    });

    if (result === null || result === undefined || result === '') {
      this.done = true;
      return null;
    }

    this.sequenceId++;
    return result;
  }

  getBatchSequenceId(): number {
    return this.sequenceId;
  }

  isBatchComplete(): boolean {
    return this.done;
  }

  cleanup(): void {
    this.reader.close();
    this.done = true;
    this.sequenceId = 0;
  }
}

/**
 * Factory for creating ScriptBatchAdaptors from a batch script function.
 */
export class ScriptBatchAdaptorFactory implements BatchAdaptorFactory {
  private batchScript: (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null;
  private sourceMap?: Map<string, unknown>;

  constructor(
    batchScript: (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null,
    sourceMap?: Map<string, unknown>
  ) {
    this.batchScript = batchScript;
    this.sourceMap = sourceMap;
  }

  createBatchAdaptor(rawMessage: string): ScriptBatchAdaptor {
    return new ScriptBatchAdaptor(rawMessage, this.batchScript, this.sourceMap);
  }
}
