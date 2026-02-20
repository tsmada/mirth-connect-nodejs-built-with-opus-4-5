/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/components/HL7BatchAdaptor.java
 *
 * Purpose: Splits HL7 batch messages on MSH segment boundaries
 *
 * Key behaviors:
 * - Splits on lines starting with "MSH" (the message header segment)
 * - Skips FHS/BHS/BTS/FTS batch envelope segments
 * - Each MSH starts a new message; subsequent non-MSH lines are appended
 * - Strips MLLP framing bytes (0x0B start, 0x1C end, trailing 0x0D after 0x1C)
 * - Supports configurable lineBreakPattern and segmentDelimiter
 * - Supports JavaScript batch script mode via ScriptBatchAdaptor delegation
 */

import type { BatchAdaptor, BatchAdaptorFactory } from './BatchAdaptor.js';
import { ScriptBatchAdaptor } from './ScriptBatchAdaptor.js';
import type { ScriptBatchReader } from './ScriptBatchAdaptor.js';

export enum HL7v2SplitType {
  MSH_Segment = 'MSH_Segment',
  JavaScript = 'JavaScript',
}

export interface HL7v2BatchProperties {
  splitType: HL7v2SplitType;
  /** Regex for line breaks in messages (default: "\\r\\n|\\r|\\n") */
  lineBreakPattern?: string;
  /** Custom segment delimiter for output (default: "\\r") */
  segmentDelimiter?: string;
  /** Batch script for JavaScript mode */
  batchScript?: string;
}

const BATCH_ENVELOPE_SEGMENTS = new Set(['FHS', 'BHS', 'BTS', 'FTS']);

/** Default line break regex matching Java's ER7BatchAdaptor */
const DEFAULT_LINE_BREAK_PATTERN = '\\r\\n|\\r|\\n';

/** Default output segment delimiter (HL7 standard CR) */
const DEFAULT_SEGMENT_DELIMITER = '\r';

/**
 * Strip MLLP framing bytes from a raw message.
 * - 0x0B (VT) start byte
 * - 0x1C (FS) end byte
 * - 0x0D (CR) immediately following 0x1C
 */
function stripMLLPFraming(raw: string): string {
  let result = raw;
  // Strip leading 0x0B (VT)
  if (result.charCodeAt(0) === 0x0b) {
    result = result.substring(1);
  }
  // Strip trailing 0x1C 0x0D or just 0x1C
  if (result.length >= 2 && result.charCodeAt(result.length - 2) === 0x1c && result.charCodeAt(result.length - 1) === 0x0d) {
    result = result.substring(0, result.length - 2);
  } else if (result.length >= 1 && result.charCodeAt(result.length - 1) === 0x1c) {
    result = result.substring(0, result.length - 1);
  }
  return result;
}

export class HL7BatchAdaptor implements BatchAdaptor {
  private messages: string[] = [];
  private index: number = 0;
  private sequenceId: number = 0;
  private scriptDelegate: ScriptBatchAdaptor | null = null;

  constructor(rawMessage: string, properties?: HL7v2BatchProperties) {
    const stripped = stripMLLPFraming(rawMessage);

    if (properties?.splitType === HL7v2SplitType.JavaScript && properties.batchScript) {
      // Delegate to ScriptBatchAdaptor for JavaScript mode
      const scriptFn = new Function('context', properties.batchScript) as
        (context: { reader: ScriptBatchReader; sourceMap: Map<string, unknown> }) => string | null;
      this.scriptDelegate = new ScriptBatchAdaptor(stripped, scriptFn);
    } else {
      const lineBreakPattern = properties?.lineBreakPattern ?? DEFAULT_LINE_BREAK_PATTERN;
      const segmentDelimiter = properties?.segmentDelimiter ?? DEFAULT_SEGMENT_DELIMITER;
      this.messages = this.splitBatch(stripped, lineBreakPattern, segmentDelimiter);
    }
  }

  private splitBatch(rawMessage: string, lineBreakPattern: string, segmentDelimiter: string): string[] {
    if (!rawMessage || rawMessage.trim().length === 0) {
      return [];
    }

    const lineBreakRegex = new RegExp(lineBreakPattern);
    const lines = rawMessage.split(lineBreakRegex);
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
          result.push(currentSegments.join(segmentDelimiter));
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
      result.push(currentSegments.join(segmentDelimiter));
    }

    return result;
  }

  async getMessage(): Promise<string | null> {
    if (this.scriptDelegate) {
      return this.scriptDelegate.getMessage();
    }
    if (this.index >= this.messages.length) {
      return null;
    }
    this.sequenceId = this.index + 1;
    return this.messages[this.index++]!;
  }

  getBatchSequenceId(): number {
    if (this.scriptDelegate) {
      return this.scriptDelegate.getBatchSequenceId();
    }
    return this.sequenceId;
  }

  isBatchComplete(): boolean {
    if (this.scriptDelegate) {
      return this.scriptDelegate.isBatchComplete();
    }
    return this.index >= this.messages.length;
  }

  cleanup(): void {
    if (this.scriptDelegate) {
      this.scriptDelegate.cleanup();
      this.scriptDelegate = null;
    }
    this.messages = [];
    this.index = 0;
    this.sequenceId = 0;
  }
}

export class HL7BatchAdaptorFactory implements BatchAdaptorFactory {
  private properties?: HL7v2BatchProperties;

  constructor(properties?: HL7v2BatchProperties) {
    this.properties = properties;
  }

  createBatchAdaptor(rawMessage: string): HL7BatchAdaptor {
    return new HL7BatchAdaptor(rawMessage, this.properties);
  }
}
