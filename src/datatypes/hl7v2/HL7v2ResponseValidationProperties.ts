/**
 * Ported from:
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2ResponseValidationProperties.java
 *
 * Purpose: Configuration for HL7v2 ACK/NAK response validation.
 * Controls which ACK codes map to SENT, ERROR, or QUEUED statuses,
 * and optional message control ID validation via MSA-2.
 */

export interface HL7v2ResponseValidationProperties {
  /** Comma-separated ACK codes that indicate success (default: 'AA,CA') */
  successfulACKCode: string;
  /** Comma-separated ACK codes that indicate error (default: 'AE,CE') */
  errorACKCode: string;
  /** Comma-separated ACK codes that indicate rejection/retry (default: 'AR,CR') */
  rejectedACKCode: string;
  /** Whether to validate MSA-2 message control ID (default: false) */
  validateMessageControlId: boolean;
  /** Expected message control ID for validation */
  originalMessageControlId: string;
  /** Map variable to get original message control ID from (default: '') */
  originalIdMapVariable: string;
}

export function getDefaultHL7v2ResponseValidationProperties(): HL7v2ResponseValidationProperties {
  return {
    successfulACKCode: 'AA,CA',
    errorACKCode: 'AE,CE',
    rejectedACKCode: 'AR,CR',
    validateMessageControlId: false,
    originalMessageControlId: '',
    originalIdMapVariable: '',
  };
}
