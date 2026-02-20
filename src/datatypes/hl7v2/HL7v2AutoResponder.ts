/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2AutoResponder.java
 *
 * Purpose: Generate automatic HL7v2 ACK responses based on MSH.15 (Accept Acknowledgment Type)
 * and the message processing status.
 *
 * Key behaviors to replicate:
 * - Parse MSH.15 from raw ER7 message to determine acknowledgment behavior
 * - AL (Always): generate ACK for all statuses (default if MSH.15 missing/empty)
 * - NE (Never): return null content response (no ACK)
 * - ER (Error only): only generate ACK when status is ERROR
 * - SU (Successful only): only generate ACK when status is NOT ERROR
 * - Map Status to ACK code via response generation properties
 * - Delegate ACK construction to HL7v2ACKGenerator
 */

import type { AutoResponder } from '../../donkey/message/AutoResponder.js';
import { Response } from '../../model/Response.js';
import { Status } from '../../model/Status.js';
import { HL7v2ACKGenerator } from './HL7v2ACKGenerator.js';
import type { HL7v2ResponseGenerationProperties } from './HL7v2ResponseGenerationProperties.js';
import { getDefaultHL7v2ResponseGenerationProperties } from './HL7v2ResponseGenerationProperties.js';

/**
 * MSH.15 Accept Acknowledgment Type values.
 * These control when the receiving application sends an accept ACK.
 */
const enum AcceptAckType {
  /** Always send ACK */
  ALWAYS = 'AL',
  /** Never send ACK */
  NEVER = 'NE',
  /** Send ACK only on error */
  ERROR_ONLY = 'ER',
  /** Send ACK only on success (non-error) */
  SUCCESSFUL_ONLY = 'SU',
}

export class HL7v2AutoResponder implements AutoResponder {
  private readonly properties: HL7v2ResponseGenerationProperties;

  constructor(properties?: Partial<HL7v2ResponseGenerationProperties>) {
    this.properties = {
      ...getDefaultHL7v2ResponseGenerationProperties(),
      ...properties,
    };
  }

  getResponse(rawMessage: string, _processedMessage: string | null, status: Status): Response {
    // Parse MSH.15 (Accept Acknowledgment Type) from the raw ER7 message
    const acceptAckType = this.parseAcceptAckType(rawMessage);

    // Determine whether to generate an ACK based on MSH.15 and status
    if (!this.shouldGenerateAck(acceptAckType, status)) {
      return new Response(status, null as unknown as string);
    }

    // Select the ACK code based on status
    const ackCode = this.getAckCode(status);

    // Build the text message (custom ackMessage or empty)
    const textMessage = this.properties.ackMessage ?? '';

    // Generate the ACK via the shared ACK generator
    const ackContent = HL7v2ACKGenerator.generateAck(rawMessage, {
      ackCode,
      textMessage,
    });

    return new Response(status, ackContent);
  }

  /**
   * Parse MSH.15 from a raw ER7 message.
   *
   * MSH fields are separated by the field separator (first char after "MSH").
   * MSH.15 is at field index 14 (0-based) when splitting the MSH segment by
   * the field separator. Note: MSH.1 (the field separator itself) is not
   * included as a split result since it IS the delimiter, so index 0 = "MSH",
   * index 1 = encoding chars, index 2 = MSH.3, etc. MSH.15 = index 14.
   *
   * If MSH.15 is missing or empty, default to AL (Always).
   */
  private parseAcceptAckType(rawMessage: string): string {
    if (!rawMessage || rawMessage.length < 4) {
      return AcceptAckType.ALWAYS;
    }

    // Field separator is the character at position 3 (right after "MSH")
    const fieldSeparator = rawMessage.charAt(3);

    // Find the end of the MSH segment (CR, LF, or end of message)
    let mshEnd = rawMessage.length;
    const crIdx = rawMessage.indexOf('\r');
    const lfIdx = rawMessage.indexOf('\n');
    if (crIdx !== -1 && lfIdx !== -1) {
      mshEnd = Math.min(crIdx, lfIdx);
    } else if (crIdx !== -1) {
      mshEnd = crIdx;
    } else if (lfIdx !== -1) {
      mshEnd = lfIdx;
    }

    const mshSegment = rawMessage.substring(0, mshEnd);
    const fields = mshSegment.split(fieldSeparator);

    // MSH.15 is at index 14 in the split array
    // fields[0] = "MSH", fields[1] = encoding chars, fields[2] = MSH.3, ...
    // MSH.15 = fields[14]
    if (fields.length > 14 && fields[14]) {
      const value = fields[14].trim().toUpperCase();
      if (value === AcceptAckType.NEVER || value === AcceptAckType.ERROR_ONLY || value === AcceptAckType.SUCCESSFUL_ONLY) {
        return value;
      }
    }

    // Default: Always generate ACK
    return AcceptAckType.ALWAYS;
  }

  /**
   * Determine whether to generate an ACK based on MSH.15 and message status.
   */
  private shouldGenerateAck(acceptAckType: string, status: Status): boolean {
    switch (acceptAckType) {
      case AcceptAckType.NEVER:
        return false;
      case AcceptAckType.ERROR_ONLY:
        return status === Status.ERROR;
      case AcceptAckType.SUCCESSFUL_ONLY:
        return status !== Status.ERROR;
      case AcceptAckType.ALWAYS:
      default:
        return true;
    }
  }

  /**
   * Map the message processing status to the appropriate ACK code.
   *
   * Java Mirth mapping:
   *   ERROR    → errorACKCode (default: AE)
   *   FILTERED → rejectedACKCode (default: AR)
   *   All else → successfulACKCode (default: AA)
   */
  private getAckCode(status: Status): string {
    switch (status) {
      case Status.ERROR:
        return this.properties.errorACKCode;
      case Status.FILTERED:
        return this.properties.rejectedACKCode;
      default:
        return this.properties.successfulACKCode;
    }
  }
}
