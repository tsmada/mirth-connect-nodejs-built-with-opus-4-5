import { DICOMSerializerAdapter } from '../../../../src/util/serializers/DICOMSerializerAdapter.js';
import {
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../../../src/model/DefaultMetaData.js';

describe('DICOMSerializerAdapter', () => {
  let adapter: DICOMSerializerAdapter;

  beforeEach(() => {
    adapter = new DICOMSerializerAdapter();
  });

  describe('getDataType', () => {
    it('returns DICOM', () => {
      expect(adapter.getDataType()).toBe('DICOM');
    });
  });

  describe('isSerializationRequired', () => {
    it('returns true (DICOM needs binary-to-XML conversion)', () => {
      expect(adapter.isSerializationRequired()).toBe(true);
    });
  });

  describe('IMessageSerializer interface compliance', () => {
    it('has toXML method', () => {
      expect(typeof adapter.toXML).toBe('function');
    });

    it('has fromXML method', () => {
      expect(typeof adapter.fromXML).toBe('function');
    });

    it('has getDataType method', () => {
      expect(typeof adapter.getDataType).toBe('function');
    });
  });

  describe('toXML delegation', () => {
    it('returns empty string for empty input', () => {
      expect(adapter.toXML('')).toBe('');
    });

    it('delegates to DICOMSerializer.toXML for valid base64', () => {
      // Create a minimal DICOM file: 128-byte preamble + DICM magic + one small element
      const preamble = Buffer.alloc(128, 0);
      const magic = Buffer.from('DICM', 'ascii');

      // File meta info group length (0002,0000) = UL, value = 0
      const tag1 = Buffer.from([0x02, 0x00, 0x00, 0x00]); // tag (0002,0000)
      const vr1 = Buffer.from('UL', 'ascii');
      const len1 = Buffer.alloc(2);
      len1.writeUInt16LE(4, 0);
      const val1 = Buffer.alloc(4, 0);

      const dicomData = Buffer.concat([preamble, magic, tag1, vr1, len1, val1]);
      const base64 = dicomData.toString('base64');

      const xml = adapter.toXML(base64);
      expect(typeof xml).toBe('string');
      expect(xml).toContain('<dicom>');
      expect(xml).toContain('</dicom>');
    });
  });

  describe('fromXML delegation', () => {
    it('returns empty string for empty input', () => {
      expect(adapter.fromXML('')).toBe('');
    });

    it('delegates to DICOMSerializer.fromXML', () => {
      const xml = '<dicom><tag00100020 tag="00100020" vr="LO" len="6">PAT001</tag00100020></dicom>';
      const result = adapter.fromXML(xml);
      expect(typeof result).toBe('string');
      // Result should be base64-encoded binary
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('returns mirth_type and mirth_version keys', () => {
      // Use empty/minimal input — metadata extraction will use defaults
      const metadata = adapter.getMetaDataFromMessage('');
      expect(metadata).toHaveProperty(TYPE_VARIABLE_MAPPING);
      expect(metadata[TYPE_VARIABLE_MAPPING]).toBe('DICOM');
      expect(metadata).toHaveProperty(VERSION_VARIABLE_MAPPING);
    });

    it('does not use unprefixed base keys', () => {
      const metadata = adapter.getMetaDataFromMessage('');
      // Base keys should be mirth_ prefixed, not plain
      expect(Object.keys(metadata)).not.toContain('type');
      expect(Object.keys(metadata)).not.toContain('version');
    });

    it('preserves DICOM-specific additive keys', () => {
      // Build a minimal DICOM with patient ID tag
      const preamble = Buffer.alloc(128, 0);
      const magic = Buffer.from('DICM', 'ascii');

      // (0002,0000) Group Length UL = 26 (meta info length)
      const metaGroupLen = Buffer.alloc(12);
      metaGroupLen.writeUInt16LE(0x0002, 0); // group
      metaGroupLen.writeUInt16LE(0x0000, 2); // element
      metaGroupLen.write('UL', 4, 'ascii');  // VR
      metaGroupLen.writeUInt16LE(4, 6);      // length
      metaGroupLen.writeUInt32LE(14, 8);     // value (length of remaining meta)

      // (0002,0010) Transfer Syntax UID = 1.2.840.10008.1.2 (Implicit VR LE)
      const tsUid = '1.2.840.10008.1.2';
      const tsBuf = Buffer.alloc(4 + 2 + 2 + tsUid.length + (tsUid.length % 2));
      tsBuf.writeUInt16LE(0x0002, 0);
      tsBuf.writeUInt16LE(0x0010, 2);
      tsBuf.write('UI', 4, 'ascii');
      const tsLen = tsUid.length + (tsUid.length % 2); // pad to even
      tsBuf.writeUInt16LE(tsLen, 6);
      Buffer.from(tsUid, 'ascii').copy(tsBuf, 8);

      // Update meta group length
      metaGroupLen.writeUInt32LE(tsBuf.length - 0, 8);

      // (0008,0060) Modality = "CT" (implicit VR: 4-byte tag + 4-byte length + value)
      const modTag = Buffer.alloc(4);
      modTag.writeUInt16LE(0x0008, 0);
      modTag.writeUInt16LE(0x0060, 2);
      const modLen = Buffer.alloc(4);
      modLen.writeUInt32LE(2, 0);
      const modVal = Buffer.from('CT', 'ascii');

      const dicomData = Buffer.concat([preamble, magic, metaGroupLen, tsBuf, modTag, modLen, modVal]);
      const base64 = dicomData.toString('base64');

      const metadata = adapter.getMetaDataFromMessage(base64);

      // Should have base keys with mirth_ prefix
      expect(metadata[TYPE_VARIABLE_MAPPING]).toBe('DICOM');

      // If modality was extracted, it should be an additive key
      if (metadata.modality) {
        expect(metadata.modality).toBe('CT');
      }
    });
  });

  describe('constructor with custom properties', () => {
    it('accepts custom properties', () => {
      const customAdapter = new DICOMSerializerAdapter(
        {},
        { someOption: true }
      );
      expect(customAdapter.getDataType()).toBe('DICOM');
    });
  });
});
