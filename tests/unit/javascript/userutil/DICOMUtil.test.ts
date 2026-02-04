/**
 * Tests for DICOMUtil
 */

import { DICOMUtil } from '../../../../src/javascript/userutil/DICOMUtil.js';

describe('DICOMUtil', () => {
  describe('mergeHeaderPixelData', () => {
    it('should merge header with pixel data', () => {
      // Create a simple DICOM header
      const header = Buffer.alloc(20);
      header.writeUInt16LE(0x0008, 0);
      header.writeUInt16LE(0x0016, 2);
      header.writeUInt32LE(10, 4);
      header.write('1.2.3.4.5 ', 8, 'ascii');

      // Create pixel data
      const pixelData = Buffer.alloc(100).fill(0xFF);

      const merged = DICOMUtil.mergeHeaderPixelData(header, [pixelData]);

      expect(merged).toBeDefined();
      expect(merged.length).toBeGreaterThan(0);

      // Verify it's valid base64
      const decoded = Buffer.from(merged, 'base64');
      expect(decoded.length).toBeGreaterThan(header.length);
    });

    it('should handle multiple frames', () => {
      const header = Buffer.alloc(20);
      header.writeUInt16LE(0x0008, 0);
      header.writeUInt16LE(0x0016, 2);
      header.writeUInt32LE(10, 4);
      header.write('1.2.3.4.5 ', 8, 'ascii');

      const frame1 = Buffer.alloc(50).fill(0xAA);
      const frame2 = Buffer.alloc(50).fill(0xBB);

      const merged = DICOMUtil.mergeHeaderPixelData(header, [frame1, frame2]);

      expect(merged).toBeDefined();
      const decoded = Buffer.from(merged, 'base64');
      expect(decoded.length).toBeGreaterThan(header.length + frame1.length + frame2.length);
    });
  });

  describe('getSliceCountFromData', () => {
    it('should return 1 for data without Number of Frames', () => {
      const data = Buffer.alloc(20);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0016, 2);
      data.writeUInt32LE(10, 4);
      data.write('1.2.3.4.5 ', 8, 'ascii');

      const count = DICOMUtil.getSliceCountFromData(data);

      expect(count).toBe(1);
    });

    it('should return count from Number of Frames tag', () => {
      // Create DICOM with Number of Frames (0028,0008)
      const data = Buffer.alloc(16);
      data.writeUInt16LE(0x0028, 0);
      data.writeUInt16LE(0x0008, 2);
      data.writeUInt32LE(2, 4);
      data.write('10', 8, 'ascii'); // 10 frames

      const count = DICOMUtil.getSliceCountFromData(data);

      expect(count).toBe(10);
    });
  });

  describe('byteArrayToDicomObject', () => {
    it('should parse DICOM data to object', () => {
      const data = Buffer.alloc(15);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0016, 2);
      data.writeUInt32LE(5, 4);
      data.write('1.2.3', 8, 'ascii');

      const dicomObj = DICOMUtil.byteArrayToDicomObject(data, false);

      expect(dicomObj).toBeDefined();
      expect(dicomObj.elements).toBeDefined();
    });

    it('should decode base64 when specified', () => {
      const data = Buffer.alloc(15);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0016, 2);
      data.writeUInt32LE(5, 4);
      data.write('1.2.3', 8, 'ascii');

      const base64 = data.toString('base64');
      const dicomObj = DICOMUtil.byteArrayToDicomObject(base64, true);

      expect(dicomObj).toBeDefined();
    });
  });

  describe('dicomObjectToByteArray', () => {
    it('should convert DicomObject back to bytes', () => {
      const dicomObj = {
        elements: new Map([
          ['00080016', { tag: '00080016', value: '1.2.3' }],
        ]),
      };

      const bytes = DICOMUtil.dicomObjectToByteArray(dicomObj);

      expect(bytes).toBeDefined();
      expect(bytes.length).toBeGreaterThan(0);
    });
  });

  describe('getTag', () => {
    it('should get tag value from DICOM data', () => {
      const data = Buffer.alloc(15);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0060, 2);  // Modality
      data.writeUInt32LE(2, 4);
      data.write('CT', 8, 'ascii');

      const value = DICOMUtil.getTag(data, '00080060');

      expect(value).toBe('CT');
    });

    it('should return null for non-existent tag', () => {
      const data = Buffer.alloc(15);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0060, 2);
      data.writeUInt32LE(2, 4);
      data.write('CT', 8, 'ascii');

      const value = DICOMUtil.getTag(data, '00100010'); // Patient Name

      expect(value).toBeNull();
    });

    it('should handle parentheses in tag format', () => {
      const data = Buffer.alloc(15);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0060, 2);
      data.writeUInt32LE(2, 4);
      data.write('CT', 8, 'ascii');

      const value = DICOMUtil.getTag(data, '(0008,0060)');

      expect(value).toBe('CT');
    });
  });

  describe('convertToXML', () => {
    it('should convert DICOM to XML', () => {
      // Element: tag (4 bytes) + length (4 bytes) + value (2 bytes) = 10 bytes
      const data = Buffer.alloc(10);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0060, 2);
      data.writeUInt32LE(2, 4);
      data.write('CT', 8, 'ascii');

      const xml = DICOMUtil.convertToXML(data);

      expect(xml).toContain('<dicom>');
      expect(xml).toContain('00080060');
      expect(xml).toContain('CT');
    });

    it('should handle base64 input', () => {
      // Element: tag (4 bytes) + length (4 bytes) + value (2 bytes) = 10 bytes
      const data = Buffer.alloc(10);
      data.writeUInt16LE(0x0008, 0);
      data.writeUInt16LE(0x0060, 2);
      data.writeUInt32LE(2, 4);
      data.write('CT', 8, 'ascii');

      const xml = DICOMUtil.convertToXML(data.toString('base64'));

      expect(xml).toContain('<dicom>');
    });
  });
});
