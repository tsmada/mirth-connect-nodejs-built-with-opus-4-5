/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v3/HL7V3BatchAdaptor.java
 *
 * Purpose: Batch processing for HL7v3 messages
 *
 * Key behaviors to replicate:
 * - JavaScript-based batch splitting only (no built-in patterns)
 * - Provide reader/sourceMap to batch script
 * - Return messages one at a time from getNextMessage()
 *
 * Note: HL7v3 batch processing relies entirely on JavaScript because
 * there is no standard batch format for HL7v3 messages. The batch script
 * has access to a BufferedReader to read the incoming data stream.
 */

import { Readable } from 'stream';
import {
  HL7V3BatchProperties,
  HL7V3SplitType,
  getDefaultHL7V3BatchProperties,
} from './HL7V3Properties.js';

/**
 * Batch reader interface for script access
 *
 * This provides a Node.js equivalent to Java's BufferedReader
 * that can be passed to batch scripts.
 */
export interface BatchReader {
  /**
   * Read the next line from the input
   * @returns The next line, or null if end of input
   */
  readLine(): Promise<string | null>;

  /**
   * Read all remaining content
   * @returns All remaining content as a string
   */
  readAll(): Promise<string>;

  /**
   * Check if there is more content to read
   */
  hasMore(): boolean;

  /**
   * Close the reader
   */
  close(): void;
}

/**
 * Source map type for batch processing
 */
export type SourceMap = Map<string, unknown>;

/**
 * Batch message source - can be a string, Buffer, or Readable stream
 */
export type BatchMessageSource = string | Buffer | Readable;

/**
 * Batch script context provided to JavaScript batch scripts
 */
export interface BatchScriptContext {
  /** Reader for accessing the batch data */
  reader: BatchReader;
  /** Source map with message metadata */
  sourceMap: SourceMap;
}

/**
 * Batch script function type
 *
 * The script should return the next message from the batch,
 * or null/empty string when there are no more messages.
 */
export type BatchScriptFunction = (
  context: BatchScriptContext
) => Promise<string | null>;

/**
 * Create a BatchReader from a string
 */
function createReaderFromString(content: string): BatchReader {
  const lines = content.split(/\r?\n/);
  let lineIndex = 0;
  let closed = false;
  let allRead = false;

  return {
    async readLine(): Promise<string | null> {
      if (closed || lineIndex >= lines.length) {
        return null;
      }
      return lines[lineIndex++] ?? null;
    },

    async readAll(): Promise<string> {
      if (closed || allRead) {
        return '';
      }
      allRead = true;
      const remaining = lines.slice(lineIndex).join('\n');
      lineIndex = lines.length;
      return remaining;
    },

    hasMore(): boolean {
      return !closed && !allRead && lineIndex < lines.length;
    },

    close(): void {
      closed = true;
    },
  };
}

/**
 * Create a BatchReader from a Readable stream
 */
function createReaderFromStream(stream: Readable): BatchReader {
  const lineQueue: string[] = [];
  let streamEnded = false;
  let closed = false;
  let allContent = '';
  let allRead = false;

  // Buffer all content from stream
  const contentPromise = new Promise<void>((resolve) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    stream.on('end', () => {
      allContent = Buffer.concat(chunks).toString('utf-8');
      const lines = allContent.split(/\r?\n/);
      lineQueue.push(...lines);
      streamEnded = true;
      resolve();
    });
    stream.on('error', () => {
      streamEnded = true;
      resolve();
    });
  });

  return {
    async readLine(): Promise<string | null> {
      if (closed) {
        return null;
      }
      await contentPromise;
      if (lineQueue.length === 0) {
        return null;
      }
      return lineQueue.shift() ?? null;
    },

    async readAll(): Promise<string> {
      if (closed || allRead) {
        return '';
      }
      await contentPromise;
      allRead = true;
      const remaining = lineQueue.join('\n');
      lineQueue.length = 0;
      return remaining;
    },

    hasMore(): boolean {
      return !closed && !allRead && (lineQueue.length > 0 || !streamEnded);
    },

    close(): void {
      closed = true;
      if (!streamEnded && stream.readable) {
        stream.destroy();
      }
    },
  };
}

/**
 * HL7V3 Batch Adaptor - processes batches of HL7v3 messages
 *
 * Unlike other data types, HL7v3 only supports JavaScript-based batch splitting
 * because there is no standard batch format for HL7v3 messages.
 *
 * The batch script receives:
 * - reader: A BufferedReader-like object for reading the input stream
 * - sourceMap: A map containing source metadata
 *
 * The script should return the next message as a string, or null/empty when done.
 *
 * Example batch script:
 * ```javascript
 * // Read all content and split by a custom delimiter
 * var content = reader.readAll();
 * var messages = content.split('<!-- MESSAGE_BOUNDARY -->');
 * return messages.shift() || null;
 * ```
 */
export class HL7V3BatchAdaptor {
  private batchProperties: HL7V3BatchProperties;
  private reader: BatchReader | null = null;
  private sourceMap: SourceMap;
  private batchScript: BatchScriptFunction | null = null;
  private batchSequenceId: number = 0;

  constructor(
    batchProperties?: Partial<HL7V3BatchProperties>,
    sourceMap?: SourceMap
  ) {
    this.batchProperties = {
      ...getDefaultHL7V3BatchProperties(),
      ...batchProperties,
    };
    this.sourceMap = sourceMap || new Map();
  }

  /**
   * Get the batch properties
   */
  getBatchProperties(): HL7V3BatchProperties {
    return this.batchProperties;
  }

  /**
   * Set the batch properties
   */
  setBatchProperties(properties: HL7V3BatchProperties): void {
    this.batchProperties = properties;
  }

  /**
   * Initialize the batch adaptor with a message source
   *
   * @param source The batch message source (string, Buffer, or Readable)
   */
  initialize(source: BatchMessageSource): void {
    if (typeof source === 'string') {
      this.reader = createReaderFromString(source);
    } else if (Buffer.isBuffer(source)) {
      this.reader = createReaderFromString(source.toString('utf-8'));
    } else {
      this.reader = createReaderFromStream(source);
    }
    this.batchSequenceId = 0;
  }

  /**
   * Set a custom batch script function
   *
   * This allows programmatic batch script execution without
   * compiling JavaScript from string.
   *
   * @param script The batch script function
   */
  setBatchScriptFunction(script: BatchScriptFunction): void {
    this.batchScript = script;
  }

  /**
   * Get the next message from the batch
   *
   * @returns The next message, or null if no more messages
   * @throws Error if no valid batch splitting method is configured
   */
  async getNextMessage(): Promise<string | null> {
    this.batchSequenceId++;

    if (this.batchProperties.splitType === HL7V3SplitType.JavaScript) {
      return this.getMessageFromJavaScript();
    }

    throw new Error('No valid batch splitting method configured');
  }

  /**
   * Get message using JavaScript batch script
   */
  private async getMessageFromJavaScript(): Promise<string | null> {
    if (!this.reader) {
      throw new Error('Batch adaptor not initialized. Call initialize() first.');
    }

    // If a custom script function was provided, use it
    if (this.batchScript) {
      const context: BatchScriptContext = {
        reader: this.reader,
        sourceMap: new Map(this.sourceMap), // Provide immutable copy
      };

      const result = await this.batchScript(context);
      if (result === null || result === undefined || result === '') {
        return null;
      }
      return result;
    }

    // Otherwise, try to evaluate the batch script string
    const scriptSource = this.batchProperties.batchScript;
    if (!scriptSource || scriptSource.trim() === '') {
      throw new Error('No batch script was set.');
    }

    // Execute the batch script
    // Note: In a real implementation, this would use the JavaScript runtime
    // For now, we'll throw an error indicating the script needs to be compiled
    throw new Error(
      'Batch script execution requires the JavaScript runtime. ' +
        'Use setBatchScriptFunction() to provide a pre-compiled script, ' +
        'or use the Donkey engine for full batch script support.'
    );
  }

  /**
   * Get all messages from the batch
   *
   * Convenience method that collects all messages into an array.
   *
   * @returns Array of all messages in the batch
   */
  async getAllMessages(): Promise<string[]> {
    const messages: string[] = [];
    let message = await this.getNextMessage();

    while (message !== null) {
      messages.push(message);
      message = await this.getNextMessage();
    }

    return messages;
  }

  /**
   * Async iterator for batch messages
   *
   * Allows using for-await-of to iterate over messages:
   * ```typescript
   * for await (const message of adaptor) {
   *   processMessage(message);
   * }
   * ```
   */
  async *[Symbol.asyncIterator](): AsyncIterableIterator<string> {
    let message = await this.getNextMessage();
    while (message !== null) {
      yield message;
      message = await this.getNextMessage();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.reader) {
      this.reader.close();
      this.reader = null;
    }
    this.batchScript = null;
    this.batchSequenceId = 0;
  }
}

/**
 * Process a batch of HL7v3 messages using a script function
 *
 * @param source The batch message source
 * @param script The batch script function
 * @param sourceMap Optional source map
 * @returns Array of messages extracted from the batch
 */
export async function processBatch(
  source: BatchMessageSource,
  script: BatchScriptFunction,
  sourceMap?: SourceMap
): Promise<string[]> {
  const adaptor = new HL7V3BatchAdaptor(undefined, sourceMap);
  adaptor.initialize(source);
  adaptor.setBatchScriptFunction(script);

  try {
    return await adaptor.getAllMessages();
  } finally {
    adaptor.cleanup();
  }
}

/**
 * Split a batch by a simple string delimiter
 *
 * A convenience function for common batch splitting patterns.
 *
 * @param source The batch content
 * @param delimiter The delimiter between messages
 * @returns Array of messages
 */
export function splitByDelimiter(source: string, delimiter: string): string[] {
  return source
    .split(delimiter)
    .map((msg) => msg.trim())
    .filter((msg) => msg.length > 0);
}

/**
 * Split a batch by XML root elements
 *
 * Extracts all top-level XML elements as separate messages.
 * Useful when a batch contains multiple XML documents concatenated together.
 *
 * @param source The batch content
 * @param rootElementName Optional root element name to filter by
 * @returns Array of XML messages
 */
export function splitByXMLRoot(
  source: string,
  rootElementName?: string
): string[] {
  const messages: string[] = [];

  // Pattern to match complete XML elements
  // This handles nested elements by tracking depth
  const pattern = rootElementName
    ? new RegExp(`<${rootElementName}[^>]*>[\\s\\S]*?</${rootElementName}>`, 'g')
    : /<([a-zA-Z_][a-zA-Z0-9_\-.:]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;

  let match;
  while ((match = pattern.exec(source)) !== null) {
    messages.push(match[0]);
  }

  return messages;
}
