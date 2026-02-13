/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/js/JavaScriptReceiverProperties.java
 *
 * Purpose: Configuration properties for the JavaScript Reader source connector
 *
 * Key behaviors:
 * - Implements PollConnectorPropertiesInterface (pollInterval from PollConnectorProperties)
 * - Implements SourceConnectorPropertiesInterface (processBatch from SourceConnectorProperties)
 * - Single property: script (the user's JavaScript code)
 * - NAME = "JavaScript Reader"
 */

export interface JavaScriptReceiverProperties {
  /** User-provided JavaScript source code executed each poll cycle */
  script: string;
  /** Poll interval in milliseconds (from PollConnectorProperties, default 5000) */
  pollInterval: number;
  /** Whether to use batch processing for results (from SourceConnectorProperties) */
  processBatch: boolean;
}

export function getDefaultJavaScriptReceiverProperties(): JavaScriptReceiverProperties {
  return {
    script: '',
    pollInterval: 5000,
    processBatch: false,
  };
}

/** Connector name matching Java JavaScriptReceiverProperties.NAME */
export const JAVASCRIPT_RECEIVER_NAME = 'JavaScript Reader';
