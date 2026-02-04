/**
 * Tests for DICOMSerializer
 */

import { DICOMSerializer } from '../../../../src/datatypes/dicom/DICOMSerializer.js';

describe('DICOMSerializer', () => {
  let serializer: DICOMSerializer;

  beforeEach(() => {
    serializer = new DICOMSerializer();
  });

  describe('isSerializationRequired', () => {
    it('should return false', () => {
      expect(serializer.isSerializationRequired(true)).toBe(false);
      expect(serializer.isSerializationRequired(false)).toBe(false);
    });
  });

  describe('toXML', () => {
    it('should return empty string for empty input', () => {
      expect(serializer.toXML('')).toBe('');
    });

    it('should convert simple DICOM data to XML', () => {
      // Create minimal DICOM data (without file preamble)
      // Tag (0008,0016) SOP Class UID = "1.2.3"
      const data = Buffer.alloc(13);
      data.writeUInt16LE(0x0008, 0);  // Group
      data.writeUInt16LE(0x0016, 2);  // Element
      data.writeUInt32LE(5, 4);       // Length
      data.write('1.2.3', 8, 'ascii'); // Value

      const base64 = data.toString('base64');
      const xml = serializer.toXML(base64);

      expect(xml).toContain('<dicom>');
      expect(xml).toContain('</dicom>');
      expect(xml).toContain('00080016');
      expect(xml).toContain('1.2.3');
    });

    it('should handle DICOM file with preamble', () => {
      // Create DICOM file with 128-byte preamble + "DICM"
      const preamble = Buffer.alloc(128);
      const magic = Buffer.from('DICM', 'ascii');

      // File Meta Information (group 0002)
      // Transfer Syntax UID (0002,0010) = "1.2.840.10008.1.2"
      const ts = Buffer.alloc(25);
      ts.writeUInt16LE(0x0002, 0);
      ts.writeUInt16LE(0x0010, 2);
      ts.write('UI', 4, 'ascii');
      ts.writeUInt16LE(17, 6);
      ts.write('1.2.840.10008.1.2', 8, 'ascii');

      const data = Buffer.concat([preamble, magic, ts]);
      const base64 = data.toString('base64');
      const xml = serializer.toXML(base64);

      expect(xml).toContain('<dicom>');
      expect(xml).toContain('00020010');
      expect(xml).toContain('1.2.840.10008.1.2');
    });
  });

  describe('fromXML', () => {
    it('should return empty string for empty input', () => {
      expect(serializer.fromXML('')).toBe('');
    });

    it('should convert XML back to base64 DICOM', () => {
      const xml = `<dicom>
  <tag00080016 tag="00080016" vr="UI" len="5">1.2.3</tag00080016>
</dicom>`;

      const base64 = serializer.fromXML(xml);

      expect(base64).toBeDefined();
      expect(base64.length).toBeGreaterThan(0);

      // Verify it's valid base64
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded.length).toBeGreaterThan(0);
    });
  });

  describe('round-trip conversion', () => {
    it('should round-trip simple DICOM data', () => {
      // Create minimal DICOM data
      const data = Buffer.alloc(13);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0016, 2);
      data.writeUInt32LE(5, 4);
      data.write('1.2.3', 8, 'ascii');

      const original = data.toString('base64');
      const xml = serializer.toXML(original);
      const roundTripped = serializer.fromXML(xml);

      // The round-tripped data should decode to similar DICOM
      const decoded = Buffer.from(roundTripped, 'base64');
      expect(decoded.length).toBeGreaterThan(0);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('should extract metadata from DICOM', () => {
      // Create DICOM with metadata tags (implicit VR little endian format)
      const elements: Buffer[] = [];

      // SOP Class UID (0008,0016) - 10 chars padded to even length
      const sopClass = Buffer.alloc(18);
      sopClass.writeUInt16LE(0x0008, 0);
      sopClass.writeUInt16LE(0x0016, 2);
      sopClass.writeUInt32LE(10, 4); // Length 10
      sopClass.write('1.2.3.4.5 ', 8, 'ascii'); // 10 chars (padded with space)
      elements.push(sopClass);

      // Modality (0008,0060) - 2 chars
      const modality = Buffer.alloc(10);
      modality.writeUInt16LE(0x0008, 0);
      modality.writeUInt16LE(0x0060, 2);
      modality.writeUInt32LE(2, 4); // Length 2
      modality.write('CT', 8, 'ascii');
      elements.push(modality);

      const data = Buffer.concat(elements);
      const metadata = serializer.getMetaDataFromMessage(data.toString('base64'));

      expect(metadata.type).toBe('DICOM');
      expect(metadata.sopClassUid).toBe('1.2.3.4.5');
      expect(metadata.modality).toBe('CT');
    });

    it('should return basic metadata on error', () => {
      const metadata = serializer.getMetaDataFromMessage('invalid-base64!!');

      expect(metadata.type).toBe('DICOM');
      expect(metadata.version).toBe('');
    });
  });

  describe('removePixelData', () => {
    it('should remove pixel data from DICOM', () => {
      // Create DICOM with metadata + pixel data
      const elements: Buffer[] = [];

      // SOP Class UID (0008,0016)
      const sopClass = Buffer.alloc(15);
      sopClass.writeUInt16LE(0x0008, 0);
      sopClass.writeUInt16LE(0x0016, 2);
      sopClass.writeUInt32LE(5, 4);
      sopClass.write('1.2.3', 8, 'ascii');
      elements.push(sopClass);

      // Pixel Data (7FE0,0010) - 100 bytes of zeros
      const pixelData = Buffer.alloc(108);
      pixelData.writeUInt16LE(0x7FE0, 0);
      pixelData.writeUInt16LE(0x0010, 2);
      pixelData.writeUInt32LE(100, 4);
      // Rest is zeros (pixel data)
      elements.push(pixelData);

      const data = Buffer.concat(elements);
      const withoutPixels = DICOMSerializer.removePixelData(data);

      // Result should be smaller (no pixel data)
      expect(withoutPixels.length).toBeLessThan(data.length);
    });
  });

  describe('toJSON', () => {
    it('should return JSON metadata', () => {
      const data = Buffer.alloc(12);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0060, 2);
      data.writeUInt32LE(2, 4);
      data.write('CT', 8, 'ascii');

      const json = serializer.toJSON(data.toString('base64'));

      expect(json).toContain('"type":"DICOM"');
    });
  });

  describe('fromJSON', () => {
    it('should return message unchanged', () => {
      const json = '{"type":"DICOM"}';
      expect(serializer.fromJSON(json)).toBe(json);
    });
  });
});
