/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/dicom/DICOMSerializer.java
 *
 * Purpose: Serialize/deserialize DICOM data to/from XML representation
 *
 * Key behaviors to replicate:
 * - Convert base64-encoded DICOM to XML (toXML)
 * - Convert XML back to base64-encoded DICOM (fromXML)
 * - Remove pixel data for display/storage
 * - Extract metadata from DICOM attributes
 */

import {
  DICOMDataTypeProperties,
  DICOMMetaData,
  DicomTag,
  formatTag,
} from './DICOMDataTypeProperties.js';

/**
 * DICOM element value representation
 */
interface DicomElement {
  tag: string;
  vr?: string;
  length: number;
  value: string | number | Buffer | DicomElement[];
}

/**
 * Transfer Syntax UIDs
 */
const TransferSyntax = {
  IMPLICIT_VR_LITTLE_ENDIAN: '1.2.840.10008.1.2',
  EXPLICIT_VR_LITTLE_ENDIAN: '1.2.840.10008.1.2.1',
  EXPLICIT_VR_BIG_ENDIAN: '1.2.840.10008.1.2.2',
};

/**
 * Value Representations that have explicit length (32-bit)
 */
const EXPLICIT_VR_32 = ['OB', 'OD', 'OF', 'OL', 'OW', 'SQ', 'UC', 'UN', 'UR', 'UT'];

/**
 * DICOM Serializer
 *
 * Converts between binary DICOM data (base64 encoded) and XML representation
 */
export class DICOMSerializer {
  // Properties are unused in current implementation but kept for API compatibility
  constructor(_properties?: Partial<DICOMDataTypeProperties>) {}

  /**
   * Check if serialization is required
   */
  isSerializationRequired(_toXml: boolean): boolean {
    return false;
  }

  /**
   * Convert DICOM (base64 encoded) to XML
   */
  toXML(source: string): string {
    if (!source || source.length === 0) {
      return '';
    }

    try {
      // Decode base64 to binary
      const dicomData = Buffer.from(source, 'base64');

      // Parse DICOM elements
      const elements = this.parseDicom(dicomData);

      // Convert to XML
      return this.elementsToXml(elements);
    } catch (error) {
      throw new Error(
        `Error converting DICOM to XML: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Convert XML back to DICOM (base64 encoded)
   */
  fromXML(source: string): string {
    if (!source || source.length === 0) {
      return '';
    }

    try {
      // Parse XML to elements
      const elements = this.xmlToElements(source);

      // Convert elements back to binary DICOM
      const dicomData = this.elementsToDicom(elements);

      // Encode as base64
      return dicomData.toString('base64');
    } catch (error) {
      throw new Error(
        `Error converting XML to DICOM: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse binary DICOM data into elements
   */
  private parseDicom(data: Buffer): DicomElement[] {
    const elements: DicomElement[] = [];
    let offset = 0;

    // Check for DICOM file (128 byte preamble + "DICM" magic)
    let isExplicitVr = false;
    let bigEndian = false;

    if (data.length > 132 && data.toString('ascii', 128, 132) === 'DICM') {
      // Skip preamble
      offset = 132;

      // Parse file meta information (always explicit VR little endian)
      const metaElements = this.parseElements(data, offset, data.length, true, false, true);
      elements.push(...metaElements.elements);
      offset = metaElements.offset;

      // Get transfer syntax from file meta info
      const tsElement = metaElements.elements.find(
        (e) =>
          e.tag ===
          formatTag(DicomTag.TRANSFER_SYNTAX_UID.group, DicomTag.TRANSFER_SYNTAX_UID.element)
      );
      if (tsElement && typeof tsElement.value === 'string') {
        const ts = tsElement.value.trim();
        if (ts === TransferSyntax.EXPLICIT_VR_BIG_ENDIAN) {
          isExplicitVr = true;
          bigEndian = true;
        } else if (ts === TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN) {
          isExplicitVr = true;
        }
        // IMPLICIT_VR_LITTLE_ENDIAN is the default
      }
    }

    // Parse dataset
    const datasetElements = this.parseElements(
      data,
      offset,
      data.length,
      isExplicitVr,
      bigEndian,
      false
    );
    elements.push(...datasetElements.elements);

    return elements;
  }

  /**
   * Parse DICOM elements from buffer
   */
  private parseElements(
    data: Buffer,
    startOffset: number,
    endOffset: number,
    explicitVr: boolean,
    bigEndian: boolean,
    isMetaInfo: boolean
  ): { elements: DicomElement[]; offset: number } {
    const elements: DicomElement[] = [];
    let offset = startOffset;

    // Force explicit VR for file meta info
    if (isMetaInfo) {
      explicitVr = true;
      bigEndian = false;
    }

    while (offset < endOffset - 4) {
      // Read tag
      const group = bigEndian ? data.readUInt16BE(offset) : data.readUInt16LE(offset);
      const element = bigEndian ? data.readUInt16BE(offset + 2) : data.readUInt16LE(offset + 2);
      offset += 4;

      // Stop at pixel data or if we've moved past file meta info
      if (isMetaInfo && group !== 0x0002) {
        offset -= 4; // Rewind
        break;
      }

      if (group === 0x7fe0 && element === 0x0010) {
        // Pixel data - store marker but skip content
        elements.push({
          tag: formatTag(group, element),
          vr: 'OW',
          length: -1,
          value: '[PIXEL DATA]',
        });
        break;
      }

      let vr = '';
      let length: number;

      if (explicitVr) {
        // Explicit VR: read VR as 2 characters
        vr = data.toString('ascii', offset, offset + 2);
        offset += 2;

        if (EXPLICIT_VR_32.includes(vr)) {
          // Skip 2 reserved bytes, then 4-byte length
          offset += 2;
          length = bigEndian ? data.readUInt32BE(offset) : data.readUInt32LE(offset);
          offset += 4;
        } else {
          // 2-byte length
          length = bigEndian ? data.readUInt16BE(offset) : data.readUInt16LE(offset);
          offset += 2;
        }
      } else {
        // Implicit VR: 4-byte length
        length = bigEndian ? data.readUInt32BE(offset) : data.readUInt32LE(offset);
        offset += 4;

        // Guess VR from tag (simplified)
        vr = this.guessVr(group, element);
      }

      // Handle undefined length (0xFFFFFFFF)
      if (length === 0xffffffff) {
        // Skip sequences with undefined length for now
        // In a full implementation, we'd parse nested items
        const endSeq = this.findSequenceEnd(data, offset);
        elements.push({
          tag: formatTag(group, element),
          vr,
          length: -1,
          value: '[SEQUENCE]',
        });
        offset = endSeq;
        continue;
      }

      // Safety check
      if (offset + length > data.length) {
        break;
      }

      // Read value
      const valueBuffer = data.subarray(offset, offset + length);
      offset += length;

      // Convert value based on VR
      let value: string | number | Buffer;
      switch (vr) {
        case 'US':
          value = bigEndian ? valueBuffer.readUInt16BE(0) : valueBuffer.readUInt16LE(0);
          break;
        case 'UL':
          value = bigEndian ? valueBuffer.readUInt32BE(0) : valueBuffer.readUInt32LE(0);
          break;
        case 'SS':
          value = bigEndian ? valueBuffer.readInt16BE(0) : valueBuffer.readInt16LE(0);
          break;
        case 'SL':
          value = bigEndian ? valueBuffer.readInt32BE(0) : valueBuffer.readInt32LE(0);
          break;
        case 'FL':
          value = bigEndian ? valueBuffer.readFloatBE(0) : valueBuffer.readFloatLE(0);
          break;
        case 'FD':
          value = bigEndian ? valueBuffer.readDoubleBE(0) : valueBuffer.readDoubleLE(0);
          break;
        case 'OB':
        case 'OW':
        case 'OF':
        case 'UN':
          // Binary data - keep as buffer
          value = valueBuffer;
          break;
        default:
          // String VRs
          value = valueBuffer.toString('ascii').replace(/\0/g, '').trim();
          break;
      }

      elements.push({
        tag: formatTag(group, element),
        vr,
        length,
        value,
      });
    }

    return { elements, offset };
  }

  /**
   * Find the end of a sequence with undefined length
   */
  private findSequenceEnd(data: Buffer, startOffset: number): number {
    let offset = startOffset;
    const seqDelimTag = 0xfffee0dd; // Sequence Delimitation Item

    while (offset < data.length - 8) {
      const tag = data.readUInt32LE(offset);
      if (tag === seqDelimTag) {
        return offset + 8; // Skip the delimitation item
      }
      offset += 4;
      const length = data.readUInt32LE(offset);
      offset += 4;
      if (length !== 0xffffffff) {
        offset += length;
      }
    }

    return data.length;
  }

  /**
   * Guess VR from tag (for implicit VR)
   */
  private guessVr(group: number, element: number): string {
    // Group 0x0002 (file meta info) uses UI for UIDs
    if (group === 0x0002) {
      if (element === 0x0010 || element === 0x0002 || element === 0x0003) {
        return 'UI';
      }
    }

    // Common patterns
    if (element === 0x0000) return 'UL'; // Group Length
    if (group === 0x0008) {
      if (element === 0x0016 || element === 0x0018) return 'UI'; // SOP UIDs
      if (element === 0x0020 || element === 0x0030) return 'DA'; // Dates
      if (element === 0x0060) return 'CS'; // Modality
    }
    if (group === 0x0010) {
      if (element === 0x0010) return 'PN'; // Patient Name
      if (element === 0x0020) return 'LO'; // Patient ID
    }
    if (group === 0x0020) {
      if (element === 0x000d || element === 0x000e) return 'UI'; // Study/Series UID
    }
    if (group === 0x0028) {
      if (element === 0x0010 || element === 0x0011) return 'US'; // Rows/Columns
    }
    if (group === 0x7fe0 && element === 0x0010) return 'OW'; // Pixel Data

    return 'UN'; // Unknown
  }

  /**
   * Convert parsed elements to XML
   */
  private elementsToXml(elements: DicomElement[]): string {
    const lines: string[] = ['<dicom>'];

    for (const elem of elements) {
      const tagLower = elem.tag.toLowerCase();
      const valueStr = this.formatValueForXml(elem.value);
      const vrAttr = elem.vr ? ` vr="${elem.vr}"` : '';
      const lenAttr = ` len="${elem.length}"`;

      lines.push(
        `  <tag${tagLower} tag="${tagLower}"${vrAttr}${lenAttr}>${valueStr}</tag${tagLower}>`
      );
    }

    lines.push('</dicom>');
    return lines.join('\n');
  }

  /**
   * Format a value for XML output
   */
  private formatValueForXml(value: string | number | Buffer | DicomElement[]): string {
    if (typeof value === 'number') {
      return value.toString();
    }
    if (typeof value === 'string') {
      return this.escapeXml(value);
    }
    if (Buffer.isBuffer(value)) {
      return value.toString('base64');
    }
    if (Array.isArray(value)) {
      return '[SEQUENCE]';
    }
    return '';
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Parse XML back to elements
   */
  private xmlToElements(xml: string): DicomElement[] {
    const elements: DicomElement[] = [];

    // Simple regex-based XML parser for DICOM XML format
    const tagRegex =
      /<tag([0-9a-f]{8})\s+tag="([^"]+)"(?:\s+vr="([^"]+)")?(?:\s+len="([^"]+)")?[^>]*>([^<]*)<\/tag\1>/gi;

    let match;
    while ((match = tagRegex.exec(xml)) !== null) {
      const [, tagHex, , vr, len, value] = match;
      elements.push({
        tag: tagHex!.toUpperCase(),
        vr: vr || undefined,
        length: len ? parseInt(len, 10) : value!.length,
        value: this.unescapeXml(value!),
      });
    }

    return elements;
  }

  /**
   * Unescape XML entities
   */
  private unescapeXml(str: string): string {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /**
   * Convert elements back to binary DICOM
   */
  private elementsToDicom(elements: DicomElement[]): Buffer {
    const buffers: Buffer[] = [];

    // Check if we have file meta info
    const hasMetaInfo = elements.some((e) => e.tag.startsWith('0002'));

    if (hasMetaInfo) {
      // Add DICOM file preamble
      buffers.push(Buffer.alloc(128)); // 128 zero bytes
      buffers.push(Buffer.from('DICM', 'ascii'));
    }

    // Find charset (default to ASCII)
    const charsetElem = elements.find((e) => e.tag === '00080005');
    const charset =
      charsetElem && typeof charsetElem.value === 'string' ? charsetElem.value : 'ascii';

    // Separate file meta info and dataset
    const metaElements = elements.filter((e) => e.tag.startsWith('0002'));
    const dataElements = elements.filter((e) => !e.tag.startsWith('0002'));

    // Write file meta info (always explicit VR little endian)
    for (const elem of metaElements) {
      buffers.push(this.encodeElement(elem, true, false, charset));
    }

    // Determine transfer syntax from meta info
    const tsElem = metaElements.find((e) => e.tag === '00020010');
    let explicitVr = false;
    let bigEndian = false;

    if (tsElem && typeof tsElem.value === 'string') {
      const ts = tsElem.value.trim();
      if (ts === TransferSyntax.EXPLICIT_VR_BIG_ENDIAN) {
        explicitVr = true;
        bigEndian = true;
      } else if (ts === TransferSyntax.EXPLICIT_VR_LITTLE_ENDIAN) {
        explicitVr = true;
      }
    }

    // Write dataset elements
    for (const elem of dataElements) {
      buffers.push(this.encodeElement(elem, explicitVr, bigEndian, charset));
    }

    return Buffer.concat(buffers);
  }

  /**
   * Encode a single DICOM element to binary
   */
  private encodeElement(
    elem: DicomElement,
    explicitVr: boolean,
    bigEndian: boolean,
    charset: string
  ): Buffer {
    // Parse tag
    const group = parseInt(elem.tag.substring(0, 4), 16);
    const element = parseInt(elem.tag.substring(4, 8), 16);

    // Get value buffer
    let valueBuffer: Buffer;
    if (typeof elem.value === 'number') {
      valueBuffer = this.encodeNumber(elem.value, elem.vr || 'UL', bigEndian);
    } else if (typeof elem.value === 'string') {
      if (elem.value === '[PIXEL DATA]' || elem.value === '[SEQUENCE]') {
        // Skip these markers
        return Buffer.alloc(0);
      }
      valueBuffer = Buffer.from(elem.value, charset === 'utf-8' ? 'utf-8' : 'ascii');
      // Pad to even length for strings
      if (valueBuffer.length % 2 !== 0) {
        const padByte = elem.vr === 'UI' ? 0x00 : 0x20; // Null for UID, space for others
        valueBuffer = Buffer.concat([valueBuffer, Buffer.from([padByte])]);
      }
    } else if (Buffer.isBuffer(elem.value)) {
      valueBuffer = elem.value;
    } else {
      valueBuffer = Buffer.alloc(0);
    }

    // Build element buffer
    const parts: Buffer[] = [];

    // Tag
    const tagBuf = Buffer.alloc(4);
    if (bigEndian) {
      tagBuf.writeUInt16BE(group, 0);
      tagBuf.writeUInt16BE(element, 2);
    } else {
      tagBuf.writeUInt16LE(group, 0);
      tagBuf.writeUInt16LE(element, 2);
    }
    parts.push(tagBuf);

    if (explicitVr && elem.vr) {
      // VR
      parts.push(Buffer.from(elem.vr, 'ascii'));

      if (EXPLICIT_VR_32.includes(elem.vr)) {
        // 2 reserved bytes + 4-byte length
        const lenBuf = Buffer.alloc(6);
        if (bigEndian) {
          lenBuf.writeUInt32BE(valueBuffer.length, 2);
        } else {
          lenBuf.writeUInt32LE(valueBuffer.length, 2);
        }
        parts.push(lenBuf);
      } else {
        // 2-byte length
        const lenBuf = Buffer.alloc(2);
        if (bigEndian) {
          lenBuf.writeUInt16BE(valueBuffer.length, 0);
        } else {
          lenBuf.writeUInt16LE(valueBuffer.length, 0);
        }
        parts.push(lenBuf);
      }
    } else {
      // Implicit VR: 4-byte length
      const lenBuf = Buffer.alloc(4);
      if (bigEndian) {
        lenBuf.writeUInt32BE(valueBuffer.length, 0);
      } else {
        lenBuf.writeUInt32LE(valueBuffer.length, 0);
      }
      parts.push(lenBuf);
    }

    // Value
    parts.push(valueBuffer);

    return Buffer.concat(parts);
  }

  /**
   * Encode a numeric value
   */
  private encodeNumber(value: number, vr: string, bigEndian: boolean): Buffer {
    let buffer: Buffer;

    switch (vr) {
      case 'US':
        buffer = Buffer.alloc(2);
        bigEndian ? buffer.writeUInt16BE(value, 0) : buffer.writeUInt16LE(value, 0);
        break;
      case 'UL':
        buffer = Buffer.alloc(4);
        bigEndian ? buffer.writeUInt32BE(value, 0) : buffer.writeUInt32LE(value, 0);
        break;
      case 'SS':
        buffer = Buffer.alloc(2);
        bigEndian ? buffer.writeInt16BE(value, 0) : buffer.writeInt16LE(value, 0);
        break;
      case 'SL':
        buffer = Buffer.alloc(4);
        bigEndian ? buffer.writeInt32BE(value, 0) : buffer.writeInt32LE(value, 0);
        break;
      case 'FL':
        buffer = Buffer.alloc(4);
        bigEndian ? buffer.writeFloatBE(value, 0) : buffer.writeFloatLE(value, 0);
        break;
      case 'FD':
        buffer = Buffer.alloc(8);
        bigEndian ? buffer.writeDoubleBE(value, 0) : buffer.writeDoubleLE(value, 0);
        break;
      default:
        buffer = Buffer.from(value.toString(), 'ascii');
    }

    return buffer;
  }

  /**
   * Remove pixel data from DICOM content
   */
  static removePixelData(content: Buffer | string): Buffer {
    const data = typeof content === 'string' ? Buffer.from(content, 'base64') : content;

    // Find and remove pixel data tag
    const serializer = new DICOMSerializer();
    const elements = serializer.parseDicom(data);

    // Filter out pixel data
    const filtered = elements.filter(
      (e) => e.tag !== formatTag(DicomTag.PIXEL_DATA.group, DicomTag.PIXEL_DATA.element)
    );

    return serializer.elementsToDicom(filtered);
  }

  /**
   * Extract metadata from DICOM content
   */
  getMetaDataFromMessage(message: string): DICOMMetaData {
    const metadata: DICOMMetaData = {
      type: 'DICOM',
      version: '',
    };

    try {
      const data = Buffer.from(message, 'base64');
      const elements = this.parseDicom(data);

      for (const elem of elements) {
        const tagLower = elem.tag.toUpperCase();

        switch (tagLower) {
          case formatTag(DicomTag.SOP_CLASS_UID.group, DicomTag.SOP_CLASS_UID.element):
            metadata.sopClassUid = String(elem.value);
            break;
          case formatTag(DicomTag.SOP_INSTANCE_UID.group, DicomTag.SOP_INSTANCE_UID.element):
            metadata.sopInstanceUid = String(elem.value);
            break;
          case formatTag(DicomTag.PATIENT_NAME.group, DicomTag.PATIENT_NAME.element):
            metadata.patientName = String(elem.value);
            break;
          case formatTag(DicomTag.PATIENT_ID.group, DicomTag.PATIENT_ID.element):
            metadata.patientId = String(elem.value);
            break;
          case formatTag(DicomTag.STUDY_INSTANCE_UID.group, DicomTag.STUDY_INSTANCE_UID.element):
            metadata.studyInstanceUid = String(elem.value);
            break;
          case formatTag(DicomTag.SERIES_INSTANCE_UID.group, DicomTag.SERIES_INSTANCE_UID.element):
            metadata.seriesInstanceUid = String(elem.value);
            break;
          case formatTag(DicomTag.MODALITY.group, DicomTag.MODALITY.element):
            metadata.modality = String(elem.value);
            break;
        }
      }
    } catch (error) {
      // Return basic metadata on error
    }

    return metadata;
  }

  /**
   * Populate metadata map
   */
  populateMetaData(message: string, map: Map<string, unknown>): void {
    const metadata = this.getMetaDataFromMessage(message);

    map.set('type', metadata.type);
    map.set('version', metadata.version);
    if (metadata.sopClassUid) map.set('sopClassUid', metadata.sopClassUid);
    if (metadata.sopInstanceUid) map.set('sopInstanceUid', metadata.sopInstanceUid);
    if (metadata.patientName) map.set('patientName', metadata.patientName);
    if (metadata.patientId) map.set('patientId', metadata.patientId);
    if (metadata.modality) map.set('modality', metadata.modality);
  }

  /**
   * Convert to JSON (not typically used for DICOM)
   */
  toJSON(message: string): string {
    const metadata = this.getMetaDataFromMessage(message);
    return JSON.stringify(metadata);
  }

  /**
   * Convert from JSON (not typically used for DICOM)
   */
  fromJSON(message: string): string {
    // JSON to DICOM is not directly supported
    // Return the message as-is
    return message;
  }
}
