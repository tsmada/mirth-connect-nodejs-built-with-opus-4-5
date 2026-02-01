/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/hl7v2/ER7Serializer.java
 *              (populateMetaData and getMetaDataFromMessage methods)
 *
 * Purpose: Extract metadata from HL7v2 messages for indexing and routing
 *
 * Key behaviors to replicate:
 * - Extract source from MSH-4 (sending facility)
 * - Extract message type from MSH-9 (e.g., ADT-A01)
 * - Extract version from MSH-12
 */

import {
  extractEncodingCharacters,
  HL7v2SerializationProperties,
  getDefaultSerializationProperties,
  unescapeSegmentDelimiter,
} from './HL7v2Properties.js';

/**
 * HL7v2 message metadata
 */
export interface HL7v2MetaData {
  /** Sending application (MSH-3) */
  sendingApplication?: string;
  /** Sending facility (MSH-4) - used as "source" */
  source?: string;
  /** Message type (MSH-9.1-MSH-9.2, e.g., "ADT-A01") */
  type?: string;
  /** HL7 version (MSH-12) */
  version?: string;
  /** Message control ID (MSH-10) */
  messageControlId?: string;
  /** Processing ID (MSH-11) */
  processingId?: string;
}

/**
 * Extract metadata from an HL7v2 ER7 message
 */
export function extractMetaData(
  message: string,
  properties?: Partial<HL7v2SerializationProperties>
): HL7v2MetaData {
  const metadata: HL7v2MetaData = {};
  const props = { ...getDefaultSerializationProperties(), ...properties };

  try {
    // Skip leading whitespace
    let index = 0;
    while (index < message.length && message.charAt(index) <= ' ') {
      index++;
    }

    // Get the index of the first segment delimiter
    const segmentDelimiter = unescapeSegmentDelimiter(props.segmentDelimiter);
    let segmentDelimiterIndex = findSegmentDelimiter(
      message,
      index,
      segmentDelimiter,
      props.convertLineBreaks
    );

    if (segmentDelimiterIndex === -1) {
      segmentDelimiterIndex = message.length;
    }

    // Check if message starts with MSH, FHS, or BHS
    const firstThree = message.substring(index, index + 3).toUpperCase();
    const isMSH = firstThree === 'MSH';
    const isHeader = isMSH || firstThree === 'FHS' || firstThree === 'BHS';

    if (!isHeader) {
      return metadata;
    }

    index += 3;

    if (index >= segmentDelimiterIndex || index >= message.length) {
      return metadata;
    }

    // Extract encoding characters
    const encoding = extractEncodingCharacters(
      message.substring(index - 3)
    );
    const fieldSeparator = encoding.fieldSeparator.charCodeAt(0);
    const componentSeparator = encoding.componentSeparator.charCodeAt(0);
    const repetitionSeparator = encoding.repetitionSeparator.charCodeAt(0);
    const subcomponentSeparator = encoding.subcomponentSeparator.charCodeAt(0);

    // Skip past field separator
    index++;

    // Skip past encoding characters (MSH-2)
    while (
      index < segmentDelimiterIndex &&
      index < message.length &&
      message.charCodeAt(index) !== fieldSeparator
    ) {
      index++;
    }

    if (index >= segmentDelimiterIndex || index >= message.length) {
      return metadata;
    }

    // Skip MSH-3 (Sending Application) - advance to MSH-4
    index = message.indexOf(String.fromCharCode(fieldSeparator), index + 1);
    if (index === -1 || index >= segmentDelimiterIndex) {
      return metadata;
    }

    // MSH-4: Source (Sending Facility)
    metadata.source = getComponent(
      message,
      index + 1,
      fieldSeparator,
      componentSeparator,
      repetitionSeparator,
      subcomponentSeparator,
      segmentDelimiterIndex,
      props.handleRepetitions,
      props.handleSubcomponents,
      false
    );

    // Skip to MSH-9
    for (let i = 4; i <= 8; i++) {
      index = message.indexOf(String.fromCharCode(fieldSeparator), index + 1);
      if (index === -1 || index >= segmentDelimiterIndex) {
        return metadata;
      }
    }

    // MSH-9: Message Type (combine type and trigger event)
    metadata.type = getComponent(
      message,
      index + 1,
      fieldSeparator,
      componentSeparator,
      repetitionSeparator,
      subcomponentSeparator,
      segmentDelimiterIndex,
      props.handleRepetitions,
      props.handleSubcomponents,
      true // Combine second component
    );

    // MSH-10: Message Control ID
    index = message.indexOf(String.fromCharCode(fieldSeparator), index + 1);
    if (index !== -1 && index < segmentDelimiterIndex) {
      metadata.messageControlId = getComponent(
        message,
        index + 1,
        fieldSeparator,
        componentSeparator,
        repetitionSeparator,
        subcomponentSeparator,
        segmentDelimiterIndex,
        props.handleRepetitions,
        props.handleSubcomponents,
        false
      );
    }

    // MSH-11: Processing ID
    index = message.indexOf(String.fromCharCode(fieldSeparator), index + 1);
    if (index !== -1 && index < segmentDelimiterIndex) {
      metadata.processingId = getComponent(
        message,
        index + 1,
        fieldSeparator,
        componentSeparator,
        repetitionSeparator,
        subcomponentSeparator,
        segmentDelimiterIndex,
        props.handleRepetitions,
        props.handleSubcomponents,
        false
      );
    }

    // MSH-12: Version ID (only for MSH, not FHS/BHS)
    if (isMSH) {
      index = message.indexOf(String.fromCharCode(fieldSeparator), index + 1);
      if (index !== -1 && index < segmentDelimiterIndex) {
        metadata.version = getComponent(
          message,
          index + 1,
          fieldSeparator,
          componentSeparator,
          repetitionSeparator,
          subcomponentSeparator,
          segmentDelimiterIndex,
          props.handleRepetitions,
          props.handleSubcomponents,
          false
        );
      }
    }
  } catch {
    // Return partial metadata on error
  }

  return metadata;
}

/**
 * Find segment delimiter position
 */
function findSegmentDelimiter(
  message: string,
  startIndex: number,
  delimiter: string,
  convertLineBreaks: boolean
): number {
  if (convertLineBreaks) {
    // Check for CR, LF, or the serialization segment delimiter
    for (let i = startIndex; i < message.length; i++) {
      const char = message.charAt(i);
      if (char === '\r' || char === '\n') {
        return i;
      }
      if (message.substring(i, i + delimiter.length) === delimiter) {
        return i;
      }
    }
    return -1;
  } else {
    return message.indexOf(delimiter, startIndex);
  }
}

/**
 * Get a component value from the message
 */
function getComponent(
  message: string,
  index: number,
  fieldSeparator: number,
  componentSeparator: number,
  repetitionSeparator: number,
  subcomponentSeparator: number,
  segmentDelimiterIndex: number,
  handleRepetitions: boolean,
  handleSubcomponents: boolean,
  combineSecond: boolean
): string {
  let result = '';
  let resultEnd = false;
  let c: number;

  // Read until field/component separator or repetition marker
  while (
    index < segmentDelimiterIndex &&
    index < message.length &&
    (c = message.charCodeAt(index)) !== fieldSeparator &&
    c !== componentSeparator &&
    (!handleRepetitions || c !== repetitionSeparator)
  ) {
    if (handleSubcomponents && c === subcomponentSeparator) {
      resultEnd = true;
    } else if (!resultEnd) {
      result += String.fromCharCode(c);
    }
    index++;
  }

  // If combining the second component
  if (combineSecond && message.charCodeAt(index) === componentSeparator) {
    let secondFound = false;
    index++;

    while (
      index < segmentDelimiterIndex &&
      index < message.length &&
      (c = message.charCodeAt(index)) !== fieldSeparator &&
      c !== componentSeparator &&
      (!handleRepetitions || c !== repetitionSeparator) &&
      (!handleSubcomponents || c !== subcomponentSeparator)
    ) {
      if (!secondFound) {
        result += '-';
        secondFound = true;
      }
      result += String.fromCharCode(c);
      index++;
    }
  }

  return result;
}

/**
 * Extract metadata from HL7v2 XML format
 */
export function extractMetaDataFromXML(xml: string): HL7v2MetaData {
  const metadata: HL7v2MetaData = {};

  // Extract MSH.4.1 (Source/Sending Facility)
  const msh4Match = xml.match(/<MSH\.4\.1>([^<]*)<\/MSH\.4\.1>/);
  if (msh4Match) {
    metadata.source = msh4Match[1];
  } else {
    // Try without component level
    const msh4AltMatch = xml.match(/<MSH\.4>([^<]*)<\/MSH\.4>/);
    if (msh4AltMatch) {
      metadata.source = msh4AltMatch[1];
    }
  }

  // Extract MSH.9.1 and MSH.9.2 for type
  const msh91Match = xml.match(/<MSH\.9\.1>([^<]*)<\/MSH\.9\.1>/);
  const msh92Match = xml.match(/<MSH\.9\.2>([^<]*)<\/MSH\.9\.2>/);

  if (msh91Match) {
    metadata.type = msh91Match[1];
    if (msh92Match && msh92Match[1]) {
      metadata.type += '-' + msh92Match[1];
    }
  }

  // Extract MSH.10.1 (Message Control ID)
  const msh10Match = xml.match(/<MSH\.10\.1>([^<]*)<\/MSH\.10\.1>/);
  if (msh10Match) {
    metadata.messageControlId = msh10Match[1];
  } else {
    const msh10AltMatch = xml.match(/<MSH\.10>([^<]*)<\/MSH\.10>/);
    if (msh10AltMatch) {
      metadata.messageControlId = msh10AltMatch[1];
    }
  }

  // Extract MSH.12.1 (Version)
  const msh12Match = xml.match(/<MSH\.12\.1>([^<]*)<\/MSH\.12\.1>/);
  if (msh12Match) {
    metadata.version = msh12Match[1];
  } else {
    const msh12AltMatch = xml.match(/<MSH\.12>([^<]*)<\/MSH\.12>/);
    if (msh12AltMatch) {
      metadata.version = msh12AltMatch[1];
    }
  }

  return metadata;
}
