/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/DICOMUtil.java
 *
 * Purpose: DICOM utility methods for Mirth scripts
 *
 * Key behaviors to replicate:
 * - getDICOMRawData() - Get merged DICOM data from attachments
 * - getDICOMMessage() - Get DICOM message bytes
 * - mergeHeaderAttachments() - Merge DICOM header with attachments
 * - getSliceCount() - Count slices in multi-frame DICOM
 * - convertDICOM() - Convert DICOM to other image formats
 * - byteArrayToDicomObject() - Parse DICOM bytes
 * - dicomObjectToByteArray() - Serialize DICOM object
 */

import { Attachment } from './Attachment.js';
import { AttachmentUtil, ImmutableConnectorMessage } from './AttachmentUtil.js';
import { DICOMSerializer } from '../../datatypes/dicom/DICOMSerializer.js';

/**
 * Simplified DICOM Object representation
 */
export interface DicomObject {
  /** Elements by tag */
  elements: Map<string, DicomElement>;
  /** Transfer syntax */
  transferSyntax?: string;
}

/**
 * DICOM Element
 */
export interface DicomElement {
  tag: string;
  vr?: string;
  value: unknown;
}

/**
 * Provides DICOM utility methods.
 */
export class DICOMUtil {
  private constructor() {
    // Private constructor - static utility class
  }

  /**
   * Re-attaches DICOM attachments with the header data in the connector message
   * and returns the resulting merged data as a Base64-encoded string.
   *
   * @param connectorMessage - The connector message to retrieve merged DICOM data for.
   * @returns The merged DICOM data, Base64-encoded.
   */
  static async getDICOMRawData(connectorMessage: ImmutableConnectorMessage): Promise<string> {
    const bytes = await this.getDICOMRawBytes(connectorMessage);
    return bytes.toString('base64');
  }

  /**
   * Re-attaches DICOM attachments with the header data in the connector message
   * and returns the resulting merged data as a byte array.
   *
   * @param connectorMessage - The connector message to retrieve merged DICOM data for.
   * @returns The merged DICOM data as a Buffer.
   */
  static async getDICOMRawBytes(connectorMessage: ImmutableConnectorMessage): Promise<Buffer> {
    // Get the raw message content
    const rawContent = connectorMessage.getRawData?.() ?? null;
    if (!rawContent) {
      return Buffer.alloc(0);
    }

    // Decode from base64 if needed
    let headerData: Buffer;
    try {
      headerData = Buffer.from(rawContent, 'base64');
    } catch (e) {
      headerData = Buffer.from(rawContent);
    }

    // Get DICOM attachments
    const attachments = await AttachmentUtil.getMessageAttachments(connectorMessage);
    const dicomAttachments = attachments.filter(
      (a) => a.getType() === 'DICOM' || a.getType()?.startsWith('application/dicom')
    );

    if (dicomAttachments.length === 0) {
      return headerData;
    }

    // Merge header with pixel data attachments
    return this.mergeHeaderPixelDataInternal(headerData, dicomAttachments);
  }

  /**
   * Re-attaches DICOM attachments with the header data in the connector message
   * and returns the resulting merged data as a byte array.
   *
   * @param connectorMessage - The connector message to retrieve merged DICOM data for.
   * @returns The merged DICOM data as a Buffer.
   */
  static async getDICOMMessage(connectorMessage: ImmutableConnectorMessage): Promise<Buffer> {
    return this.getDICOMRawBytes(connectorMessage);
  }

  /**
   * Re-attaches DICOM attachments with the header data in the connector message
   * and returns the resulting merged data as a Base-64 encoded String.
   *
   * @param connectorMessage - The connector message containing header data.
   * @param attachments - The DICOM attachments to merge with the header data.
   * @returns The merged DICOM data as a Base-64 encoded String.
   */
  static async mergeHeaderAttachments(
    connectorMessage: ImmutableConnectorMessage,
    attachments: Attachment[]
  ): Promise<string> {
    const rawContent = connectorMessage.getRawData?.() ?? null;
    if (!rawContent) {
      return '';
    }

    let headerData: Buffer;
    try {
      headerData = Buffer.from(rawContent, 'base64');
    } catch (e) {
      headerData = Buffer.from(rawContent);
    }

    const merged = this.mergeHeaderPixelDataInternal(headerData, attachments);
    return merged.toString('base64');
  }

  /**
   * Re-attaches DICOM attachments with the given header data
   * and returns the resulting merged data as a Base-64 encoded String.
   *
   * @param header - The header data to merge DICOM attachments with.
   * @param images - The DICOM attachments as byte arrays to merge with the header data.
   * @returns The merged DICOM data as a Base-64 encoded String.
   */
  static mergeHeaderPixelData(header: Buffer, images: Buffer[]): string {
    const attachments = images.map((img) => {
      const attachment = new Attachment();
      attachment.setContent(img);
      return attachment;
    });

    const merged = this.mergeHeaderPixelDataInternal(header, attachments);
    return merged.toString('base64');
  }

  /**
   * Internal method to merge header with pixel data
   */
  private static mergeHeaderPixelDataInternal(header: Buffer, attachments: Attachment[]): Buffer {
    if (attachments.length === 0) {
      return header;
    }

    // Find where pixel data should be inserted
    // Look for pixel data tag (7FE0,0010)
    let insertOffset = header.length;
    let offset = 0;

    // Skip DICOM preamble if present
    if (header.length > 132 && header.toString('ascii', 128, 132) === 'DICM') {
      offset = 132;
    }

    while (offset < header.length - 8) {
      const group = header.readUInt16LE(offset);
      const element = header.readUInt16LE(offset + 2);

      if (group === 0x7FE0 && element === 0x0010) {
        // Found pixel data tag
        insertOffset = offset;
        break;
      }

      // Skip to next element (simplified - assumes implicit VR)
      const length = header.readUInt32LE(offset + 4);
      if (length === 0xFFFFFFFF) {
        // Undefined length - skip to end
        break;
      }
      offset += 8 + length;
    }

    // Build merged buffer
    const parts: Buffer[] = [];

    // Add header up to pixel data location
    parts.push(header.subarray(0, insertOffset));

    // Add pixel data tag with encapsulated data if multiple frames
    if (attachments.length > 1) {
      // Encapsulated pixel data format
      const tagBuf = Buffer.alloc(8);
      tagBuf.writeUInt16LE(0x7FE0, 0);
      tagBuf.writeUInt16LE(0x0010, 2);
      tagBuf.writeUInt32LE(0xFFFFFFFF, 4); // Undefined length
      parts.push(tagBuf);

      // Add basic offset table (empty)
      const offsetTableTag = Buffer.alloc(8);
      offsetTableTag.writeUInt16LE(0xFFFE, 0);
      offsetTableTag.writeUInt16LE(0xE000, 2);
      offsetTableTag.writeUInt32LE(0, 4);
      parts.push(offsetTableTag);

      // Add each frame as an item
      for (const attachment of attachments) {
        const content = attachment.getContent();
        if (content === undefined) continue;
        const frameData = Buffer.isBuffer(content) ? content : Buffer.alloc(0);

        const itemTag = Buffer.alloc(8);
        itemTag.writeUInt16LE(0xFFFE, 0);
        itemTag.writeUInt16LE(0xE000, 2);
        // Pad to even length
        const paddedLength = frameData.length + (frameData.length % 2);
        itemTag.writeUInt32LE(paddedLength, 4);
        parts.push(itemTag);
        parts.push(frameData);
        if (paddedLength > frameData.length) {
          parts.push(Buffer.from([0x00])); // Padding byte
        }
      }

      // Add sequence delimitation item
      const seqDelimTag = Buffer.alloc(8);
      seqDelimTag.writeUInt16LE(0xFFFE, 0);
      seqDelimTag.writeUInt16LE(0xE0DD, 2);
      seqDelimTag.writeUInt32LE(0, 4);
      parts.push(seqDelimTag);
    } else {
      // Single frame - native pixel data
      const content = attachments[0]!.getContent();
      if (content === undefined) {
        return Buffer.concat(parts);
      }
      const pixelData = Buffer.isBuffer(content) ? content : Buffer.alloc(0);

      const tagBuf = Buffer.alloc(8);
      tagBuf.writeUInt16LE(0x7FE0, 0);
      tagBuf.writeUInt16LE(0x0010, 2);
      tagBuf.writeUInt32LE(pixelData.length, 4);
      parts.push(tagBuf);
      parts.push(pixelData);
    }

    return Buffer.concat(parts);
  }

  /**
   * Returns the number of slices in the fully-merged DICOM data
   * associated with a given connector message.
   *
   * @param connectorMessage - The connector message to retrieve DICOM data for.
   * @returns The number of slices in the DICOM data.
   */
  static async getSliceCount(connectorMessage: ImmutableConnectorMessage): Promise<number> {
    const data = await this.getDICOMRawBytes(connectorMessage);
    return this.getSliceCountFromData(data);
  }

  /**
   * Get slice count from DICOM data
   */
  static getSliceCountFromData(data: Buffer): number {
    // Look for Number of Frames (0028,0008)
    let offset = 0;

    if (data.length > 132 && data.toString('ascii', 128, 132) === 'DICM') {
      offset = 132;
    }

    while (offset < data.length - 8) {
      const group = data.readUInt16LE(offset);
      const element = data.readUInt16LE(offset + 2);

      if (group === 0x0028 && element === 0x0008) {
        // Number of Frames - read as string (IS VR)
        const length = data.readUInt32LE(offset + 4);
        const value = data.toString('ascii', offset + 8, offset + 8 + length).trim();
        return parseInt(value, 10) || 1;
      }

      if (group > 0x0028) break;

      const length = data.readUInt32LE(offset + 4);
      if (length === 0xFFFFFFFF) break;
      offset += 8 + length;
    }

    return 1; // Default to 1 slice
  }

  /**
   * Converts merged DICOM data associated with a connector message
   * into a specified image format.
   *
   * Note: Image conversion requires additional image processing libraries.
   * This implementation provides a stub that extracts raw pixel data.
   *
   * @param imageType - The image format to convert to (e.g., "jpg", "png").
   * @param connectorMessage - The connector message to retrieve DICOM data for.
   * @param sliceIndex - Which slice to use (1-indexed, default 1).
   * @param autoThreshold - If true, auto-adjust threshold levels.
   * @returns The converted image as a Base64-encoded string.
   */
  static async convertDICOM(
    imageType: string,
    connectorMessage: ImmutableConnectorMessage,
    sliceIndex: number = 1,
    autoThreshold: boolean = false
  ): Promise<string> {
    const data = await this.getDICOMRawBytes(connectorMessage);
    const imageData = await this.convertDICOMData(imageType, data, sliceIndex, autoThreshold);
    return imageData.toString('base64');
  }

  /**
   * Converts merged DICOM data associated with a connector message
   * into a specified image format.
   *
   * @param imageType - The image format to convert to (e.g., "jpg", "png").
   * @param connectorMessage - The connector message to retrieve DICOM data for.
   * @param sliceIndex - Which slice to use (1-indexed).
   * @param autoThreshold - If true, auto-adjust threshold levels.
   * @returns The converted image as a Buffer.
   */
  static async convertDICOMToByteArray(
    imageType: string,
    connectorMessage: ImmutableConnectorMessage,
    sliceIndex: number = 1,
    autoThreshold: boolean = false
  ): Promise<Buffer> {
    const data = await this.getDICOMRawBytes(connectorMessage);
    return this.convertDICOMData(imageType, data, sliceIndex, autoThreshold);
  }

  /**
   * Internal method to convert DICOM data to image format
   *
   * Note: Full image conversion requires canvas or image processing libraries.
   * This is a simplified implementation that extracts pixel data.
   */
  private static async convertDICOMData(
    imageType: string,
    data: Buffer,
    sliceIndex: number,
    _autoThreshold: boolean
  ): Promise<Buffer> {
    // Extract image parameters
    const rows = this.getElementValue(data, 0x0028, 0x0010, 'US') as number || 0;
    const columns = this.getElementValue(data, 0x0028, 0x0011, 'US') as number || 0;
    const bitsAllocated = this.getElementValue(data, 0x0028, 0x0100, 'US') as number || 16;
    const bitsStored = this.getElementValue(data, 0x0028, 0x0101, 'US') as number || 12;

    // Find pixel data
    let pixelDataOffset = 0;
    let offset = data.length > 132 && data.toString('ascii', 128, 132) === 'DICM' ? 132 : 0;

    while (offset < data.length - 8) {
      const group = data.readUInt16LE(offset);
      const element = data.readUInt16LE(offset + 2);

      if (group === 0x7FE0 && element === 0x0010) {
        pixelDataOffset = offset + 8;
        break;
      }

      const length = data.readUInt32LE(offset + 4);
      if (length === 0xFFFFFFFF) {
        offset += 8;
        continue;
      }
      offset += 8 + length;
    }

    if (pixelDataOffset === 0 || rows === 0 || columns === 0) {
      throw new Error('Invalid DICOM data: missing pixel data or image dimensions');
    }

    // For now, return raw pixel data as base64
    // Full implementation would convert to actual image format
    console.warn(
      `DICOM image conversion to ${imageType} requires additional image processing libraries. ` +
        `Returning raw pixel data. Image dimensions: ${columns}x${rows}, ${bitsStored} bits.`
    );

    const frameSize = rows * columns * (bitsAllocated / 8);
    const frameOffset = pixelDataOffset + (sliceIndex - 1) * frameSize;
    const pixelData = data.subarray(frameOffset, frameOffset + frameSize);

    return pixelData;
  }

  /**
   * Get a specific element value from DICOM data
   */
  private static getElementValue(
    data: Buffer,
    groupNum: number,
    elementNum: number,
    vr: string
  ): unknown {
    let offset = data.length > 132 && data.toString('ascii', 128, 132) === 'DICM' ? 132 : 0;

    while (offset < data.length - 8) {
      const group = data.readUInt16LE(offset);
      const element = data.readUInt16LE(offset + 2);

      if (group === groupNum && element === elementNum) {
        const length = data.readUInt32LE(offset + 4);
        const valueOffset = offset + 8;

        switch (vr) {
          case 'US':
            return data.readUInt16LE(valueOffset);
          case 'UL':
            return data.readUInt32LE(valueOffset);
          case 'SS':
            return data.readInt16LE(valueOffset);
          case 'SL':
            return data.readInt32LE(valueOffset);
          default:
            return data.toString('ascii', valueOffset, valueOffset + length).trim();
        }
      }

      if (group > groupNum) break;

      const length = data.readUInt32LE(offset + 4);
      if (length === 0xFFFFFFFF) break;
      offset += 8 + length;
    }

    return null;
  }

  /**
   * Converts a byte array into a DicomObject.
   *
   * @param bytes - The binary data to convert.
   * @param decodeBase64 - If true, the data is assumed to be Base64-encoded.
   * @returns The converted DicomObject.
   */
  static byteArrayToDicomObject(bytes: Buffer | string, decodeBase64: boolean = false): DicomObject {
    let data: Buffer;

    if (typeof bytes === 'string') {
      data = decodeBase64 ? Buffer.from(bytes, 'base64') : Buffer.from(bytes);
    } else {
      data = decodeBase64 ? Buffer.from(bytes.toString('ascii'), 'base64') : bytes;
    }

    const dicomObject: DicomObject = {
      elements: new Map(),
    };

    // Parse DICOM elements
    const serializer = new DICOMSerializer();
    const xml = serializer.toXML(data.toString('base64'));

    // Extract elements from XML
    const tagRegex = /<tag([0-9a-f]{8})[^>]*>([^<]*)<\/tag\1>/gi;
    let match;

    while ((match = tagRegex.exec(xml)) !== null) {
      const [, tagHex, value] = match;
      dicomObject.elements.set(tagHex!.toUpperCase(), {
        tag: tagHex!.toUpperCase(),
        value: value,
      });
    }

    // Get transfer syntax
    const tsElement = dicomObject.elements.get('00020010');
    if (tsElement) {
      dicomObject.transferSyntax = String(tsElement.value);
    }

    return dicomObject;
  }

  /**
   * Converts a DicomObject into a byte array.
   *
   * @param dicomObject - The DicomObject to convert.
   * @returns The converted byte array.
   */
  static dicomObjectToByteArray(dicomObject: DicomObject): Buffer {
    // Build XML from DicomObject
    const lines: string[] = ['<dicom>'];

    for (const [tag, element] of dicomObject.elements) {
      const tagLower = tag.toLowerCase();
      const value = String(element.value);
      lines.push(`  <tag${tagLower} tag="${tagLower}" len="${value.length}">${value}</tag${tagLower}>`);
    }

    lines.push('</dicom>');
    const xml = lines.join('\n');

    // Use serializer to convert to binary
    const serializer = new DICOMSerializer();
    const base64 = serializer.fromXML(xml);

    return Buffer.from(base64, 'base64');
  }

  /**
   * Get a specific DICOM tag value from data
   *
   * @param data - The DICOM data (Buffer or base64 string)
   * @param tag - The tag in format "00080016" or "(0008,0016)"
   * @returns The tag value or null if not found
   */
  static getTag(data: Buffer | string, tag: string): string | number | null {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'base64') : data;

    // Parse tag
    const cleanTag = tag.replace(/[(),]/g, '');
    const group = parseInt(cleanTag.substring(0, 4), 16);
    const element = parseInt(cleanTag.substring(4, 8), 16);

    let offset = buffer.length > 132 && buffer.toString('ascii', 128, 132) === 'DICM' ? 132 : 0;

    while (offset < buffer.length - 8) {
      const g = buffer.readUInt16LE(offset);
      const e = buffer.readUInt16LE(offset + 2);

      if (g === group && e === element) {
        const length = buffer.readUInt32LE(offset + 4);
        const value = buffer.toString('ascii', offset + 8, offset + 8 + length);
        return value.replace(/\0/g, '').trim();
      }

      if (g > group) break;

      const length = buffer.readUInt32LE(offset + 4);
      if (length === 0xFFFFFFFF) break;
      offset += 8 + length;
    }

    return null;
  }

  /**
   * Convert DICOM to XML representation
   *
   * @param data - The DICOM data (Buffer or base64 string)
   * @returns XML representation of the DICOM data
   */
  static convertToXML(data: Buffer | string): string {
    const base64 = typeof data === 'string' ? data : data.toString('base64');
    const serializer = new DICOMSerializer();
    return serializer.toXML(base64);
  }
}
