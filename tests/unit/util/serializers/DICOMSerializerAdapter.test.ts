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

    it('has populateMetaData method', () => {
      expect(typeof adapter.populateMetaData).toBe('function');
    });

    it('has getMetaDataFromMessage method', () => {
      expect(typeof adapter.getMetaDataFromMessage).toBe('function');
    });
  });

  describe('toXML delegation', () => {
    it('returns empty string for empty input', () => {
      expect(adapter.toXML('')).toBe('');
    });

    it('delegates to DICOMSerializer.toXML for valid base64', () => {
      const preamble = Buffer.alloc(128, 0);
      const magic = Buffer.from('DICM', 'ascii');
      const tag1 = Buffer.from([0x02, 0x00, 0x00, 0x00]);
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
      expect(result!.length).toBeGreaterThan(0);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('returns Map with mirth_type and mirth_version keys', () => {
      const metadata = adapter.getMetaDataFromMessage('');
      expect(metadata).toBeInstanceOf(Map);
      expect(metadata.has(TYPE_VARIABLE_MAPPING)).toBe(true);
      expect(metadata.get(TYPE_VARIABLE_MAPPING)).toBe('DICOM');
      expect(metadata.has(VERSION_VARIABLE_MAPPING)).toBe(true);
    });

    it('does not use unprefixed base keys', () => {
      const metadata = adapter.getMetaDataFromMessage('');
      expect(metadata.has('type')).toBe(false);
      expect(metadata.has('version')).toBe(false);
    });
  });

  describe('populateMetaData', () => {
    it('populates map with mirth_ prefixed keys', () => {
      const map = new Map<string, unknown>();
      adapter.populateMetaData('', map);
      expect(map.has(TYPE_VARIABLE_MAPPING)).toBe(true);
      expect(map.get(TYPE_VARIABLE_MAPPING)).toBe('DICOM');
      expect(map.has(VERSION_VARIABLE_MAPPING)).toBe(true);
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
