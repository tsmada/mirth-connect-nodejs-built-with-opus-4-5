/**
 * Ported from:
 *   ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2ResponseGenerationProperties.java
 *
 * Purpose: Configuration for HL7v2 automatic ACK response generation.
 * Controls which ACK code is used for each message processing outcome.
 */

export interface HL7v2ResponseGenerationProperties {
  /** ACK code for successfully processed messages (default: "AA") */
  successfulACKCode: string;
  /** ACK code for errored messages (default: "AE") */
  errorACKCode: string;
  /** ACK code for filtered/rejected messages (default: "AR") */
  rejectedACKCode: string;
  /** Custom ACK message template (supports ${variable} replacement) */
  ackMessage?: string;
}

export function getDefaultHL7v2ResponseGenerationProperties(): HL7v2ResponseGenerationProperties {
  return {
    successfulACKCode: 'AA',
    errorACKCode: 'AE',
    rejectedACKCode: 'AR',
  };
}
