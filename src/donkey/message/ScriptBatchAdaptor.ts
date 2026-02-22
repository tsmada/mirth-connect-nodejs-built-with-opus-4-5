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

import vm from 'node:vm';
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

/** Default timeout for batch script execution (30 seconds, matching other script types) */
const BATCH_SCRIPT_TIMEOUT_MS = 30_000;

/**
 * Compile a user-defined batch script string into a sandboxed function.
 *
 * Uses vm.createContext() + vm.Script to execute the script in an isolated V8 context,
 * preventing access to require(), process, global, and the filesystem.
 * Only `reader` and `sourceMap` are visible in the script scope.
 *
 * @param scriptBody The user's batch script source code
 * @returns A function that executes the script in a sandboxed context
 */
export function compileBatchScript(
  scriptBody: string,
  timeoutMs: number = BATCH_SCRIPT_TIMEOUT_MS
): (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null {
  // Wrap user script in an IIFE that executes immediately within runInContext().
  // reader and sourceMap are injected into the sandbox context, NOT passed as function args.
  // This ensures the timeout applies to the actual user script execution, not just
  // the function definition (which would evaluate instantly and defeat the timeout).
  const wrappedSource = `(function() { ${scriptBody} })()`;
  const compiled = new vm.Script(wrappedSource, { filename: 'batch-script.js' });

  return (ctx: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => {
    const sandbox = vm.createContext({
      reader: ctx.reader,
      sourceMap: ctx.sourceMap,
      // Disable timer functions to prevent scheduled code surviving script timeout
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      queueMicrotask: undefined,
    });

    return compiled.runInContext(sandbox, { timeout: timeoutMs }) as string | null;
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
