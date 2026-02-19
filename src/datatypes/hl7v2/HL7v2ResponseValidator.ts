/**
 * Ported from:
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2ResponseValidator.java
 *
 * Purpose: Validates HL7v2 ACK/NAK responses by parsing the MSA segment.
 * Maps ACK codes (AA, AE, AR, CA, CE, CR) to pipeline statuses (SENT, ERROR, QUEUED).
 * Optionally validates message control ID (MSA-2) against the original request's MSH-10.
 */

import { ResponseValidator } from '../../donkey/message/ResponseValidator.js';
import { ConnectorMessage } from '../../model/ConnectorMessage.js';
import { Status } from '../../model/Status.js';
import {
  HL7v2ResponseValidationProperties,
  getDefaultHL7v2ResponseValidationProperties,
} from './HL7v2ResponseValidationProperties.js';

/**
 * HL7v2-specific response validator.
 *
 * Parses the MSA segment from ACK/NAK responses and maps the acknowledgment
 * code to a pipeline status. Used by destination connectors to determine
 * whether a sent message was accepted (SENT), rejected with error (ERROR),
 * or rejected for retry (QUEUED).
 */
export class HL7v2ResponseValidator implements ResponseValidator {
  private readonly properties: HL7v2ResponseValidationProperties;

  private readonly successCodes: Set<string>;
  private readonly errorCodes: Set<string>;
  private readonly rejectedCodes: Set<string>;

  constructor(properties?: Partial<HL7v2ResponseValidationProperties>) {
    this.properties = {
      ...getDefaultHL7v2ResponseValidationProperties(),
      ...properties,
    };

    this.successCodes = this.parseCodeList(this.properties.successfulACKCode);
    this.errorCodes = this.parseCodeList(this.properties.errorACKCode);
    this.rejectedCodes = this.parseCodeList(this.properties.rejectedACKCode);
  }

  validate(response: string | null, connectorMessage: ConnectorMessage): string | null {
    if (response == null || response.length === 0) {
      return response;
    }

    const msaFields = this.extractMSAFields(response);
    if (msaFields == null) {
      return response;
    }

    const ackCode = msaFields.ackCode.trim().toUpperCase();
    const messageControlId = msaFields.messageControlId;

    // Check ACK code against configured code lists
    if (this.successCodes.has(ackCode)) {
      connectorMessage.setStatus(Status.SENT);

      // Validate message control ID if enabled
      if (this.properties.validateMessageControlId) {
        const originalId = this.getOriginalMessageControlId(connectorMessage);
        if (originalId && messageControlId !== originalId) {
          connectorMessage.setStatus(Status.ERROR);
          return `Expected message control ID '${originalId}' in MSA-2 but received '${messageControlId}'`;
        }
      }

      return response;
    }

    if (this.errorCodes.has(ackCode)) {
      connectorMessage.setStatus(Status.ERROR);
      return response;
    }

    if (this.rejectedCodes.has(ackCode)) {
      connectorMessage.setStatus(Status.QUEUED);
      return response;
    }

    // Unknown ACK code -- return response unchanged, don't modify status
    return response;
  }

  /**
   * Parse the MSA segment from an HL7v2 response message.
   * Returns the ACK code (MSA-1) and message control ID (MSA-2), or null if no MSA found.
   */
  private extractMSAFields(response: string): { ackCode: string; messageControlId: string } | null {
    // Split by segment delimiter (CR). Also handle LF and CRLF for robustness.
    const segments = response.split(/\r\n|\r|\n/);

    for (const segment of segments) {
      const trimmed = segment.trim();
      if (trimmed.startsWith('MSA')) {
        const fields = trimmed.split('|');
        // MSA|ackCode|messageControlId|...
        // fields[0] = "MSA", fields[1] = ack code, fields[2] = message control ID
        const ackCode = fields[1] ?? '';
        const messageControlId = fields[2] ?? '';
        return { ackCode, messageControlId };
      }
    }

    return null;
  }

  /**
   * Get the original message control ID for validation.
   * Checks the explicit property first, then falls back to map variable lookup.
   */
  private getOriginalMessageControlId(connectorMessage: ConnectorMessage): string {
    // Use explicit property if set
    if (this.properties.originalMessageControlId) {
      return this.properties.originalMessageControlId;
    }

    // Look up from map variable if configured
    if (this.properties.originalIdMapVariable) {
      const mapValue =
        connectorMessage.getConnectorMap().get(this.properties.originalIdMapVariable) ??
        connectorMessage.getChannelMap().get(this.properties.originalIdMapVariable) ??
        connectorMessage.getSourceMap().get(this.properties.originalIdMapVariable);
      if (mapValue != null) {
        return String(mapValue);
      }
    }

    return '';
  }

  /**
   * Parse a comma-separated list of ACK codes into a set, normalizing to uppercase.
   */
  private parseCodeList(codes: string): Set<string> {
    const set = new Set<string>();
    for (const code of codes.split(',')) {
      const trimmed = code.trim().toUpperCase();
      if (trimmed.length > 0) {
        set.add(trimmed);
      }
    }
    return set;
  }
}
