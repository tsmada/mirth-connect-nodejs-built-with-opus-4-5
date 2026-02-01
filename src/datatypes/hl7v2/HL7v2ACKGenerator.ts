/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/HL7v2ACKGenerator.java
 *
 * Purpose: Generate HL7v2 ACK (acknowledgment) responses
 *
 * Key behaviors to replicate:
 * - Extract MSH fields from incoming message
 * - Swap sending/receiving applications and facilities
 * - Generate MSH and MSA segments for ACK
 * - Support AA (accept), AE (error), AR (reject) codes
 * - Support versions 2.1 through 2.5+
 */

import { extractEncodingCharacters } from './HL7v2Properties.js';

/**
 * HL7v2 ACK codes
 */
export enum AckCode {
  /** Application Accept - message accepted */
  AA = 'AA',
  /** Application Error - error in message */
  AE = 'AE',
  /** Application Reject - message rejected */
  AR = 'AR',
  /** Commit Accept - commit accepted (enhanced mode) */
  CA = 'CA',
  /** Commit Error - commit error (enhanced mode) */
  CE = 'CE',
  /** Commit Reject - commit rejected (enhanced mode) */
  CR = 'CR',
}

/**
 * Options for ACK generation
 */
export interface AckGeneratorOptions {
  /** Acknowledgment code (default: AA) */
  ackCode?: AckCode | string;
  /** Text message for MSA-3 */
  textMessage?: string;
  /** Error message for ERR segment */
  errorMessage?: string;
  /** Date format for timestamps (default: yyyyMMddHHmmss) */
  dateFormat?: string;
  /** Segment delimiter (default: \r) */
  segmentDelimiter?: string;
}

/**
 * Extracted MSH header fields
 */
interface MSHFields {
  fieldSeparator: string;
  componentSeparator: string;
  repetitionSeparator: string;
  escapeCharacter: string;
  subcomponentSeparator: string;
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  originalEvent: string;
  messageControlId: string;
  processingId: string;
  processingIdMode: string;
  versionId: string;
}

/**
 * HL7v2 ACK Generator
 */
export class HL7v2ACKGenerator {
  /**
   * Generate an ACK response for an HL7 message
   */
  static generateAck(message: string, options: AckGeneratorOptions = {}): string {
    const {
      ackCode = AckCode.AA,
      textMessage = '',
      errorMessage = '',
      segmentDelimiter = '\r',
    } = options;

    if (!message || message.length < 9) {
      throw new Error(
        `Unable to parse message. It is NULL or too short: ${message}`
      );
    }

    // Extract MSH fields from the message
    const mshFields = this.extractMSHFields(message, segmentDelimiter);

    // Format timestamp
    const timestamp = this.formatTimestamp(new Date());

    // Build ACK message
    const parts: string[] = [];

    // MSH segment
    parts.push(
      this.buildMSHSegment(
        mshFields,
        timestamp
      )
    );

    // MSA segment
    parts.push(
      this.buildMSASegment(
        mshFields,
        ackCode,
        textMessage
      )
    );

    // ERR segment (if error message provided)
    if (errorMessage) {
      parts.push(
        `ERR${mshFields.fieldSeparator}${errorMessage}`
      );
    }

    return parts.join(segmentDelimiter) + segmentDelimiter;
  }

  /**
   * Extract MSH fields from message
   */
  private static extractMSHFields(
    message: string,
    segmentDelimiter: string
  ): MSHFields {
    const encoding = extractEncodingCharacters(message);

    const result: MSHFields = {
      fieldSeparator: encoding.fieldSeparator,
      componentSeparator: encoding.componentSeparator,
      repetitionSeparator: encoding.repetitionSeparator,
      escapeCharacter: encoding.escapeCharacter,
      subcomponentSeparator: encoding.subcomponentSeparator,
      sendingApplication: '',
      sendingFacility: '',
      receivingApplication: '',
      receivingFacility: '',
      originalEvent: '',
      messageControlId: '',
      processingId: 'P',
      processingIdMode: '',
      versionId: '2.4',
    };

    // Find first segment delimiter
    const firstDelimIndex = this.findSegmentDelimiter(message, segmentDelimiter);
    const mshString =
      firstDelimIndex !== -1
        ? message.substring(0, firstDelimIndex)
        : message;

    // Split MSH by field separator
    const fields = mshString.split(encoding.fieldSeparator);
    const componentPattern = encoding.componentSeparator;

    // Extract fields
    // MSH-3: Sending Application
    if (fields.length > 2 && fields[2]) {
      result.sendingApplication = this.getFirstComponent(
        fields[2],
        componentPattern
      );
    }

    // MSH-4: Sending Facility
    if (fields.length > 3 && fields[3]) {
      result.sendingFacility = this.getFirstComponent(
        fields[3],
        componentPattern
      );
    }

    // MSH-5: Receiving Application
    if (fields.length > 4 && fields[4]) {
      result.receivingApplication = this.getFirstComponent(
        fields[4],
        componentPattern
      );
    }

    // MSH-6: Receiving Facility
    if (fields.length > 5 && fields[5]) {
      result.receivingFacility = this.getFirstComponent(
        fields[5],
        componentPattern
      );
    }

    // MSH-9: Message Type (get event from component 2)
    if (fields.length > 8 && fields[8]) {
      const msgType = fields[8].split(componentPattern);
      if (msgType.length > 1 && msgType[1]) {
        result.originalEvent = msgType[1];
      }
    }

    // MSH-10: Message Control ID
    if (fields.length > 9 && fields[9]) {
      result.messageControlId = this.getFirstComponent(
        fields[9],
        componentPattern
      );
    }

    // MSH-11: Processing ID
    if (fields.length > 10 && fields[10]) {
      const procId = fields[10].split(componentPattern);
      result.processingId = procId[0] || 'P';
      if (procId.length > 1 && procId[1]) {
        result.processingIdMode = procId[1];
      }
    }

    // MSH-12: Version ID
    if (fields.length > 11 && fields[11]) {
      result.versionId =
        this.getFirstComponent(fields[11], componentPattern) || '2.4';
    }

    // Set defaults
    if (!result.messageControlId) {
      result.messageControlId = '1';
    }
    if (!result.receivingApplication) {
      result.receivingApplication = 'MIRTH';
    }

    return result;
  }

  /**
   * Build MSH segment for ACK
   */
  private static buildMSHSegment(
    fields: MSHFields,
    timestamp: string
  ): string {
    const {
      fieldSeparator,
      componentSeparator,
      repetitionSeparator,
      escapeCharacter,
      subcomponentSeparator,
      sendingApplication,
      sendingFacility,
      receivingApplication,
      receivingFacility,
      originalEvent,
      processingId,
      processingIdMode,
      versionId,
    } = fields;

    const parts: string[] = [];

    // MSH.1-2: Field separator and encoding characters
    parts.push(`MSH${fieldSeparator}${componentSeparator}${repetitionSeparator}${escapeCharacter}${subcomponentSeparator}`);

    // MSH.3: Sending Application (swap - was receiving)
    parts.push(receivingApplication);

    // MSH.4: Sending Facility (swap - was receiving)
    parts.push(receivingFacility);

    // MSH.5: Receiving Application (swap - was sending)
    parts.push(sendingApplication);

    // MSH.6: Receiving Facility (swap - was sending)
    parts.push(sendingFacility);

    // MSH.7: Date/Time
    parts.push(timestamp);

    // MSH.8: Security (empty)
    parts.push('');

    // MSH.9: Message Type
    let messageType = 'ACK';
    // For HL7 2.4+, include original event and structure
    if (this.isVersion24OrLater(versionId) && originalEvent) {
      messageType = `ACK${componentSeparator}${originalEvent}${componentSeparator}ACK`;
    }
    parts.push(messageType);

    // MSH.10: Message Control ID
    parts.push(timestamp);

    // MSH.11: Processing ID
    let procIdValue = processingId;
    if (processingIdMode) {
      procIdValue += componentSeparator + processingIdMode;
    }
    parts.push(procIdValue);

    // MSH.12: Version ID
    parts.push(versionId);

    return parts.join(fieldSeparator);
  }

  /**
   * Build MSA segment for ACK
   */
  private static buildMSASegment(
    fields: MSHFields,
    ackCode: AckCode | string,
    textMessage: string
  ): string {
    const { fieldSeparator, messageControlId } = fields;

    let msa = `MSA${fieldSeparator}${ackCode}${fieldSeparator}${messageControlId}`;

    if (textMessage) {
      msa += fieldSeparator + textMessage;
    }

    return msa;
  }

  /**
   * Find segment delimiter in message
   */
  private static findSegmentDelimiter(
    message: string,
    delimiter: string
  ): number {
    // Check for the delimiter itself
    const idx = message.indexOf(delimiter);
    if (idx !== -1) return idx;

    // Also check for common line endings
    const crIndex = message.indexOf('\r');
    const lfIndex = message.indexOf('\n');

    if (crIndex !== -1 && lfIndex !== -1) {
      return Math.min(crIndex, lfIndex);
    }
    if (crIndex !== -1) return crIndex;
    if (lfIndex !== -1) return lfIndex;

    return -1;
  }

  /**
   * Get first component of a field
   */
  private static getFirstComponent(field: string, separator: string): string {
    const idx = field.indexOf(separator);
    return idx !== -1 ? field.substring(0, idx) : field;
  }

  /**
   * Check if version is 2.4 or later
   */
  private static isVersion24OrLater(version: string): boolean {
    const parts = version.split('.');
    if (parts.length < 2 || !parts[0] || !parts[1]) return false;

    const major = parseInt(parts[0], 10);
    const minor = parseInt(parts[1], 10);

    if (isNaN(major) || isNaN(minor)) return true; // Default to 2.4+ behavior

    return major > 2 || (major === 2 && minor >= 4);
  }

  /**
   * Format timestamp for HL7
   */
  private static formatTimestamp(date: Date): string {
    const pad = (n: number, width: number = 2) =>
      n.toString().padStart(width, '0');

    return (
      date.getFullYear().toString() +
      pad(date.getMonth() + 1) +
      pad(date.getDate()) +
      pad(date.getHours()) +
      pad(date.getMinutes()) +
      pad(date.getSeconds())
    );
  }
}

/**
 * Generate ACK for an HL7 message (convenience function)
 */
export function generateAck(
  message: string,
  ackCode: AckCode | string = AckCode.AA,
  textMessage?: string
): string {
  return HL7v2ACKGenerator.generateAck(message, {
    ackCode,
    textMessage,
  });
}

/**
 * Generate NAK (negative acknowledgment) for an HL7 message
 */
export function generateNak(
  message: string,
  errorMessage?: string,
  textMessage?: string
): string {
  return HL7v2ACKGenerator.generateAck(message, {
    ackCode: AckCode.AE,
    textMessage,
    errorMessage,
  });
}
