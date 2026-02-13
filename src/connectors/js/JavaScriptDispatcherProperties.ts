/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/js/JavaScriptDispatcherProperties.java
 *
 * Purpose: Configuration properties for the JavaScript Writer destination connector
 *
 * Key behaviors:
 * - Implements DestinationConnectorPropertiesInterface
 * - Single property: script (the user's JavaScript code)
 * - NAME = "JavaScript Writer"
 * - canValidateResponse() returns true
 * - toFormattedString() returns "Script Executed"
 */

export interface JavaScriptDispatcherProperties {
  /** User-provided JavaScript source code executed for each message */
  script: string;
}

export function getDefaultJavaScriptDispatcherProperties(): JavaScriptDispatcherProperties {
  return {
    script: '',
  };
}

/** Connector name matching Java JavaScriptDispatcherProperties.NAME */
export const JAVASCRIPT_DISPATCHER_NAME = 'JavaScript Writer';
