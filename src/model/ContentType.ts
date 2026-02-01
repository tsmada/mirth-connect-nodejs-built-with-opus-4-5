/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/model/message/ContentType.java
 *
 * Purpose: Types of message content stored at various pipeline stages
 *
 * Key behaviors to replicate:
 * - Match Java enum values exactly
 * - Database ID representation
 */

/**
 * Content types matching Mirth Connect Java implementation.
 * These represent different stages/forms of message content.
 */
export enum ContentType {
  /** Raw message as received from source */
  RAW = 1,

  /** Message after preprocessor execution */
  PROCESSED_RAW = 2,

  /** Message transformed to internal format */
  TRANSFORMED = 3,

  /** Message encoded for destination format */
  ENCODED = 4,

  /** Message sent to destination */
  SENT = 5,

  /** Response received from destination */
  RESPONSE = 6,

  /** Response after response transformer */
  RESPONSE_TRANSFORMED = 7,

  /** Processed response returned to source */
  PROCESSED_RESPONSE = 8,

  /** Connector map data */
  CONNECTOR_MAP = 9,

  /** Channel map data */
  CHANNEL_MAP = 10,

  /** Response map data */
  RESPONSE_MAP = 11,

  /** Processing error details */
  PROCESSING_ERROR = 12,

  /** Postprocessor error details */
  POSTPROCESSOR_ERROR = 13,

  /** Source map data */
  SOURCE_MAP = 14,
}

/**
 * Content type descriptions for display purposes
 */
export const CONTENT_TYPE_DESCRIPTIONS: Record<ContentType, string> = {
  [ContentType.RAW]: 'Raw',
  [ContentType.PROCESSED_RAW]: 'Processed Raw',
  [ContentType.TRANSFORMED]: 'Transformed',
  [ContentType.ENCODED]: 'Encoded',
  [ContentType.SENT]: 'Sent',
  [ContentType.RESPONSE]: 'Response',
  [ContentType.RESPONSE_TRANSFORMED]: 'Response Transformed',
  [ContentType.PROCESSED_RESPONSE]: 'Processed Response',
  [ContentType.CONNECTOR_MAP]: 'Connector Map',
  [ContentType.CHANNEL_MAP]: 'Channel Map',
  [ContentType.RESPONSE_MAP]: 'Response Map',
  [ContentType.PROCESSING_ERROR]: 'Processing Error',
  [ContentType.POSTPROCESSOR_ERROR]: 'Postprocessor Error',
  [ContentType.SOURCE_MAP]: 'Source Map',
};

/**
 * Parse a content type ID from database to ContentType enum
 */
export function parseContentType(id: number): ContentType {
  if (id < 1 || id > 14) {
    throw new Error(`Unknown content type ID: ${id}`);
  }
  return id as ContentType;
}
