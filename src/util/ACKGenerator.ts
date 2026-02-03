/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/ACKGenerator.java
 *
 * Purpose: Generate HL7 v2.x acknowledgment messages.
 * Used by connectors to create ACK responses to inbound HL7 messages.
 *
 * Key behaviors to replicate:
 * - Parse inbound HL7 message to extract MSH fields
 * - Generate ACK with swapped sender/receiver
 * - Support different ACK codes (AA, AR, AE)
 * - Support custom text messages and error messages
 * - Support both ER7 and XML formats
 */

import { format } from 'date-fns';

/**
 * Default date format for MSH.7 field.
 */
const DEFAULT_DATE_FORMAT = 'yyyyMMddHHmmss';

/**
 * HL7 segment delimiter (carriage return).
 */
const SEGMENT_DELIMITER = '\r';

/**
 * HL7 field delimiter (pipe).
 */

/**
 * HL7 component delimiter (caret).
 */
const COMPONENT_DELIMITER = '^';

/**
 * ACK code type enum.
 */
export type ACKCode = 'AA' | 'AR' | 'AE' | 'CA' | 'CR' | 'CE';

/**
 * Options for ACK generation.
 */
export interface ACKOptions {
  /**
   * The MSA.1 ACK code (AA=Accept, AR=Reject, AE=Error).
   */
  ackCode: ACKCode;

  /**
   * Custom text message for MSA.3.
   */
  textMessage?: string;

  /**
   * Date format for MSH.7 timestamp.
   * Default: 'yyyyMMddHHmmss'
   */
  dateFormat?: string;

  /**
   * Error message for ERR.1 segment. If blank, ERR segment is not included.
   */
  errorMessage?: string;

  /**
   * If true, the input message is XML format and output will also be XML.
   */
  isXML?: boolean;

  /**
   * Custom segment delimiter.
   * Default: '\r'
   */
  segmentDelimiter?: string;
}

/**
 * Parsed MSH segment fields.
 */
interface MSHFields {
  fieldSeparator: string;
  encodingCharacters: string;
  sendingApplication?: string;
  sendingFacility?: string;
  receivingApplication?: string;
  receivingFacility?: string;
  dateTimeOfMessage?: string;
  security?: string;
  messageType?: string;
  messageControlId?: string;
  processingId?: string;
  versionId?: string;
}

/**
 * ACKGenerator generates HL7 v2.x acknowledgment messages.
 */
export class ACKGenerator {
  /**
   * Generates an HL7 v2.x acknowledgment with default options.
   * Uses default date format and no error segment.
   *
   * @param message - The inbound HL7 v2.x message
   * @param ackCode - The MSA.1 ACK code (AA, AR, AE)
   * @param textMessage - The MSA.3 text message
   * @returns The generated ACK message
   */
  static generateAckResponse(message: string, ackCode: ACKCode, textMessage?: string): string {
    return this.generateAckResponseFull(message, {
      ackCode,
      textMessage,
      dateFormat: DEFAULT_DATE_FORMAT,
      errorMessage: '',
      isXML: false,
    });
  }

  /**
   * Generates an HL7 v2.x acknowledgment with full options.
   *
   * @param message - The inbound HL7 v2.x message
   * @param options - ACK generation options
   * @returns The generated ACK message
   */
  static generateAckResponseFull(message: string, options: ACKOptions): string {
    const {
      ackCode,
      textMessage = '',
      dateFormat = DEFAULT_DATE_FORMAT,
      errorMessage = '',
      isXML = false,
      segmentDelimiter = SEGMENT_DELIMITER,
    } = options;

    if (isXML) {
      return this.generateXMLAck(message, ackCode, textMessage, dateFormat, errorMessage);
    }

    return this.generateER7Ack(
      message,
      ackCode,
      textMessage,
      dateFormat,
      errorMessage,
      segmentDelimiter
    );
  }

  /**
   * Parse MSH segment from ER7 message.
   */
  private static parseMSH(message: string): MSHFields {
    // Default field separator and encoding characters
    const defaultFields: MSHFields = {
      fieldSeparator: '|',
      encodingCharacters: '^~\\&',
    };

    if (!message || !message.startsWith('MSH')) {
      return defaultFields;
    }

    // MSH.1 is the character at position 3 (after 'MSH')
    const fieldSeparator = message.charAt(3) || '|';

    // Find the end of MSH segment
    const segmentEnd = message.indexOf('\r');
    const mshSegment = segmentEnd > 0 ? message.substring(0, segmentEnd) : message;

    // Split by field separator
    const fields = mshSegment.split(fieldSeparator);

    // Parse fields (MSH.1 is the separator itself, not in the array)
    // fields[0] = 'MSH'
    // fields[1] = MSH.2 (encoding characters)
    // fields[2] = MSH.3 (sending application)
    // etc.

    return {
      fieldSeparator,
      encodingCharacters: fields[1] || '^~\\&',
      sendingApplication: fields[2] || '',
      sendingFacility: fields[3] || '',
      receivingApplication: fields[4] || '',
      receivingFacility: fields[5] || '',
      dateTimeOfMessage: fields[6] || '',
      security: fields[7] || '',
      messageType: fields[8] || '',
      messageControlId: fields[9] || '',
      processingId: fields[10] || '',
      versionId: fields[11] || '',
    };
  }

  /**
   * Generate ER7 format ACK.
   */
  private static generateER7Ack(
    message: string,
    ackCode: ACKCode,
    textMessage: string,
    dateFormat: string,
    errorMessage: string,
    segmentDelimiter: string
  ): string {
    const msh = this.parseMSH(message);
    const timestamp = this.formatTimestamp(dateFormat);
    const segments: string[] = [];

    // Build MSH segment (swap sender/receiver)
    const mshFields = [
      'MSH',
      msh.encodingCharacters,
      msh.receivingApplication || '', // MSH.3: Original receiver becomes sender
      msh.receivingFacility || '', // MSH.4
      msh.sendingApplication || '', // MSH.5: Original sender becomes receiver
      msh.sendingFacility || '', // MSH.6
      timestamp, // MSH.7
      '', // MSH.8: Security
      this.buildAckMessageType(msh.messageType), // MSH.9: Message Type
      msh.messageControlId || this.generateControlId(), // MSH.10
      msh.processingId || 'P', // MSH.11
      msh.versionId || '2.5', // MSH.12
    ];

    segments.push(mshFields.join(msh.fieldSeparator));

    // Build MSA segment
    const msaFields = [
      'MSA',
      ackCode, // MSA.1: Acknowledgment Code
      msh.messageControlId || '', // MSA.2: Message Control ID
      textMessage || '', // MSA.3: Text Message
    ];

    segments.push(msaFields.join(msh.fieldSeparator));

    // Build ERR segment if error message provided
    if (errorMessage && errorMessage.trim()) {
      const errFields = ['ERR', errorMessage];
      segments.push(errFields.join(msh.fieldSeparator));
    }

    return segments.join(segmentDelimiter) + segmentDelimiter;
  }

  /**
   * Build ACK message type from original message type.
   */
  private static buildAckMessageType(originalType?: string): string {
    if (!originalType) {
      return 'ACK';
    }

    // Parse original message type (e.g., "ADT^A01^ADT_A01")
    const components = originalType.split(COMPONENT_DELIMITER);

    // ACK message type format: ACK^{trigger}^ACK
    if (components.length >= 2) {
      return `ACK${COMPONENT_DELIMITER}${components[1]}${COMPONENT_DELIMITER}ACK`;
    }

    return 'ACK';
  }

  /**
   * Generate XML format ACK.
   */
  private static generateXMLAck(
    message: string,
    ackCode: ACKCode,
    textMessage: string,
    dateFormat: string,
    errorMessage: string
  ): string {
    // Parse XML message to extract MSH fields
    const msh = this.parseXMLMSH(message);
    const timestamp = this.formatTimestamp(dateFormat);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<ACK xmlns="urn:hl7-org:v2xml">\n';

    // MSH segment
    xml += '  <MSH>\n';
    xml += '    <MSH.1>|</MSH.1>\n';
    xml += '    <MSH.2>^~\\&amp;</MSH.2>\n';
    xml += `    <MSH.3><HD.1>${this.escapeXml(msh.receivingApplication || '')}</HD.1></MSH.3>\n`;
    xml += `    <MSH.4><HD.1>${this.escapeXml(msh.receivingFacility || '')}</HD.1></MSH.4>\n`;
    xml += `    <MSH.5><HD.1>${this.escapeXml(msh.sendingApplication || '')}</HD.1></MSH.5>\n`;
    xml += `    <MSH.6><HD.1>${this.escapeXml(msh.sendingFacility || '')}</HD.1></MSH.6>\n`;
    xml += `    <MSH.7><TS.1>${timestamp}</TS.1></MSH.7>\n`;
    xml += '    <MSH.9>\n';
    xml += '      <MSG.1>ACK</MSG.1>\n';
    xml += '    </MSH.9>\n';
    xml += `    <MSH.10>${this.escapeXml(msh.messageControlId || this.generateControlId())}</MSH.10>\n`;
    xml += `    <MSH.11><PT.1>${msh.processingId || 'P'}</PT.1></MSH.11>\n`;
    xml += `    <MSH.12><VID.1>${msh.versionId || '2.5'}</VID.1></MSH.12>\n`;
    xml += '  </MSH>\n';

    // MSA segment
    xml += '  <MSA>\n';
    xml += `    <MSA.1>${ackCode}</MSA.1>\n`;
    xml += `    <MSA.2>${this.escapeXml(msh.messageControlId || '')}</MSA.2>\n`;
    if (textMessage) {
      xml += `    <MSA.3>${this.escapeXml(textMessage)}</MSA.3>\n`;
    }
    xml += '  </MSA>\n';

    // ERR segment if error message provided
    if (errorMessage && errorMessage.trim()) {
      xml += '  <ERR>\n';
      xml += `    <ERR.1>${this.escapeXml(errorMessage)}</ERR.1>\n`;
      xml += '  </ERR>\n';
    }

    xml += '</ACK>';

    return xml;
  }

  /**
   * Parse MSH fields from XML message.
   */
  private static parseXMLMSH(xml: string): MSHFields {
    const defaultFields: MSHFields = {
      fieldSeparator: '|',
      encodingCharacters: '^~\\&',
    };

    // Simple regex-based parsing for MSH fields
    const getValue = (pattern: RegExp): string | undefined => {
      const match = xml.match(pattern);
      return match ? match[1] : undefined;
    };

    return {
      ...defaultFields,
      sendingApplication:
        getValue(/<MSH\.3>.*?<HD\.1>([^<]*)<\/HD\.1>.*?<\/MSH\.3>/s) ||
        getValue(/<MSH\.3>([^<]*)<\/MSH\.3>/),
      sendingFacility:
        getValue(/<MSH\.4>.*?<HD\.1>([^<]*)<\/HD\.1>.*?<\/MSH\.4>/s) ||
        getValue(/<MSH\.4>([^<]*)<\/MSH\.4>/),
      receivingApplication:
        getValue(/<MSH\.5>.*?<HD\.1>([^<]*)<\/HD\.1>.*?<\/MSH\.5>/s) ||
        getValue(/<MSH\.5>([^<]*)<\/MSH\.5>/),
      receivingFacility:
        getValue(/<MSH\.6>.*?<HD\.1>([^<]*)<\/HD\.1>.*?<\/MSH\.6>/s) ||
        getValue(/<MSH\.6>([^<]*)<\/MSH\.6>/),
      messageControlId: getValue(/<MSH\.10>([^<]*)<\/MSH\.10>/),
      processingId:
        getValue(/<MSH\.11>.*?<PT\.1>([^<]*)<\/PT\.1>.*?<\/MSH\.11>/s) ||
        getValue(/<MSH\.11>([^<]*)<\/MSH\.11>/),
      versionId:
        getValue(/<MSH\.12>.*?<VID\.1>([^<]*)<\/VID\.1>.*?<\/MSH\.12>/s) ||
        getValue(/<MSH\.12>([^<]*)<\/MSH\.12>/),
    };
  }

  /**
   * Format timestamp using the specified format.
   */
  private static formatTimestamp(dateFormat: string): string {
    try {
      return format(new Date(), dateFormat);
    } catch {
      // Fall back to default format if custom format fails
      return format(new Date(), DEFAULT_DATE_FORMAT);
    }
  }

  /**
   * Generate a unique message control ID.
   */
  private static generateControlId(): string {
    return `${Date.now()}`;
  }

  /**
   * Escape special XML characters.
   */
  private static escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}

// Export shorthand function
export const generateAckResponse = ACKGenerator.generateAckResponse.bind(ACKGenerator);
export const generateAckResponseFull = ACKGenerator.generateAckResponseFull.bind(ACKGenerator);
