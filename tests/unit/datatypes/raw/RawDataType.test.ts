/**
 * Unit tests for Raw DataType
 *
 * Tests pass-through behavior with no transformation.
 */

import {
  RawDataType,
  RawSplitType,
  getDefaultRawBatchProperties,
  getDefaultRawDataTypeProperties,
  passThrough,
  extractRawMetaData,
} from '../../../../src/datatypes/raw/index.js';

describe('RawDataType', () => {
  describe('Default Properties', () => {
    it('should return correct default batch properties', () => {
      const props = getDefaultRawBatchProperties();
      expect(props.splitType).toBe(RawSplitType.JavaScript);
      expect(props.batchScript).toBe('');
    });

    it('should return correct default data type properties', () => {
      const props = getDefaultRawDataTypeProperties();
      expect(props.batchProperties).toBeDefined();
      expect(props.batchProperties.splitType).toBe(RawSplitType.JavaScript);
    });
  });

  describe('Serialization', () => {
    let dataType: RawDataType;

    beforeEach(() => {
      dataType = new RawDataType();
    });

    it('should report serialization not required', () => {
      expect(dataType.isSerializationRequired()).toBe(false);
      expect(dataType.isSerializationRequired(true)).toBe(false);
      expect(dataType.isSerializationRequired(false)).toBe(false);
    });

    it('should return null for transformWithoutSerializing', () => {
      expect(dataType.transformWithoutSerializing('test message')).toBeNull();
    });

    it('should return null for toXML', () => {
      expect(dataType.toXML('test message')).toBeNull();
      expect(dataType.toXML('<xml>data</xml>')).toBeNull();
      expect(dataType.toXML('binary\x00data')).toBeNull();
    });

    it('should return null for fromXML', () => {
      expect(dataType.fromXML('<xml>test</xml>')).toBeNull();
      expect(dataType.fromXML('plain text')).toBeNull();
    });

    it('should return null for toJSON', () => {
      expect(dataType.toJSON('test message')).toBeNull();
    });

    it('should return null for fromJSON', () => {
      expect(dataType.fromJSON('{"test": "data"}')).toBeNull();
    });
  });

  describe('Metadata', () => {
    let dataType: RawDataType;

    beforeEach(() => {
      dataType = new RawDataType();
    });

    it('should return null for getMetaData', () => {
      expect(dataType.getMetaData('any message')).toBeNull();
      expect(dataType.getMetaData('')).toBeNull();
    });

    it('should not modify map in populateMetaData', () => {
      const map: Record<string, unknown> = { existing: 'value' };
      dataType.populateMetaData('message', map);
      expect(map).toEqual({ existing: 'value' });
    });
  });

  describe('Batch Properties', () => {
    it('should return batch properties', () => {
      const dataType = new RawDataType();
      const batchProps = dataType.getBatchProperties();
      expect(batchProps.splitType).toBe(RawSplitType.JavaScript);
    });

    it('should use custom batch properties', () => {
      const dataType = new RawDataType({
        batchProperties: {
          splitType: RawSplitType.JavaScript,
          batchScript: 'return reader.readLine();',
        },
      });
      const batchProps = dataType.getBatchProperties();
      expect(batchProps.batchScript).toBe('return reader.readLine();');
    });
  });

  describe('Purged Properties', () => {
    it('should return purged properties with script line count', () => {
      const dataType = new RawDataType({
        batchProperties: {
          splitType: RawSplitType.JavaScript,
          batchScript: 'line1\nline2\nline3',
        },
      });
      const purged = dataType.getPurgedProperties();
      expect(purged.batchProperties).toBeDefined();
      const batchPurged = purged.batchProperties as Record<string, unknown>;
      expect(batchPurged.splitType).toBe(RawSplitType.JavaScript);
      expect(batchPurged.batchScriptLines).toBe(3);
    });

    it('should handle empty batch script', () => {
      const dataType = new RawDataType();
      const purged = dataType.getPurgedProperties();
      const batchPurged = purged.batchProperties as Record<string, unknown>;
      expect(batchPurged.batchScriptLines).toBe(0);
    });
  });
});

describe('Convenience Functions', () => {
  describe('passThrough', () => {
    it('should return input unchanged', () => {
      expect(passThrough('hello')).toBe('hello');
      expect(passThrough('')).toBe('');
      expect(passThrough('binary\x00data')).toBe('binary\x00data');
    });

    it('should handle various message types', () => {
      const xmlMessage = '<root><child>value</child></root>';
      const jsonMessage = '{"key": "value"}';
      const hl7Message = 'MSH|^~\\&|...';
      const binaryData = '\x01\x02\x03\x04\x05';

      expect(passThrough(xmlMessage)).toBe(xmlMessage);
      expect(passThrough(jsonMessage)).toBe(jsonMessage);
      expect(passThrough(hl7Message)).toBe(hl7Message);
      expect(passThrough(binaryData)).toBe(binaryData);
    });
  });

  describe('extractRawMetaData', () => {
    it('should always return null', () => {
      expect(extractRawMetaData('any message')).toBeNull();
      expect(extractRawMetaData('')).toBeNull();
      expect(extractRawMetaData('<xml/>')).toBeNull();
    });
  });
});
