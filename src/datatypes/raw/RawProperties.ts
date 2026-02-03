/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/raw/RawBatchProperties.java
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/raw/RawDataTypeProperties.java
 *
 * Purpose: Properties for Raw data type batch processing
 *
 * Key behaviors to replicate:
 * - Batch splitting via JavaScript only
 * - Default empty batch script
 */

/**
 * Split type options for raw batch processing
 */
export enum RawSplitType {
  JavaScript = 'JavaScript',
}

/**
 * Raw batch processing properties
 */
export interface RawBatchProperties {
  /** Method for splitting batch messages */
  splitType: RawSplitType;
  /** JavaScript code for custom batch splitting */
  batchScript: string;
}

/**
 * Raw data type properties
 */
export interface RawDataTypeProperties {
  /** Batch processing properties */
  batchProperties: RawBatchProperties;
}

/**
 * Get default raw batch properties
 */
export function getDefaultRawBatchProperties(): RawBatchProperties {
  return {
    splitType: RawSplitType.JavaScript,
    batchScript: '',
  };
}

/**
 * Get default raw data type properties
 */
export function getDefaultRawDataTypeProperties(): RawDataTypeProperties {
  return {
    batchProperties: getDefaultRawBatchProperties(),
  };
}

/**
 * Property descriptors for raw batch properties
 */
export const RAW_BATCH_PROPERTY_DESCRIPTORS = {
  splitType: {
    name: 'Split Batch By',
    description:
      'Select the method for splitting the batch message. This option has no effect unless Process Batch Files is enabled in the connector.\n\nJavaScript: Use JavaScript to split messages.',
    type: 'option' as const,
    options: Object.values(RawSplitType),
  },
  batchScript: {
    name: 'JavaScript',
    description:
      "Enter JavaScript that splits the batch, and returns the next message. This script has access to 'reader', a Java BufferedReader, to read the incoming data stream. The script must return a string containing the next message, or a null/empty string to indicate end of input. This option has no effect unless Process Batch is enabled in the connector.",
    type: 'javascript' as const,
  },
};
