/**
 * Ported from: ~/Projects/connect/donkey/src/main/java/com/mirth/connect/donkey/server/channel/ResponseValidator.java
 *
 * Purpose: Validates responses from destination connectors after send().
 * Used by queue processing to detect failed responses (e.g., HL7 NAK) that should trigger retry.
 */

import { ConnectorMessage } from '../../model/ConnectorMessage.js';

/**
 * Interface for validating destination connector responses.
 * Implementations can inspect the response content and connector message
 * to determine if the send was truly successful.
 */
export interface ResponseValidator {
  /**
   * Validate a response and return a validated/modified response string.
   * May set the connector message status based on validation result
   * (e.g., Status.ERROR for NAK responses).
   *
   * @param response - The raw response from the destination
   * @param connectorMessage - The connector message (may be modified)
   * @returns The validated response string (may be modified), or null
   */
  validate(response: string | null, connectorMessage: ConnectorMessage): string | null;
}

/**
 * Default pass-through validator that returns responses unchanged.
 * Does not modify the connector message status.
 */
export class DefaultResponseValidator implements ResponseValidator {
  validate(response: string | null, _connectorMessage: ConnectorMessage): string | null {
    return response;
  }
}
