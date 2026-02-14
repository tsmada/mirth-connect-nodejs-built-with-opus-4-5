import { NCPDPSerializerAdapter } from '../../../../src/util/serializers/NCPDPSerializerAdapter.js';
import {
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../../../src/model/DefaultMetaData.js';

describe('NCPDPSerializerAdapter', () => {
  let adapter: NCPDPSerializerAdapter;

  beforeEach(() => {
    adapter = new NCPDPSerializerAdapter();
  });

  describe('getDataType', () => {
    it('returns NCPDP', () => {
      expect(adapter.getDataType()).toBe('NCPDP');
    });
  });

  describe('isSerializationRequired', () => {
    it('returns false (matches Java)', () => {
      expect(adapter.isSerializationRequired()).toBe(false);
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
    it('delegates to NCPDPSerializer.toXML', () => {
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'TestField';

      const xml = adapter.toXML(message);
      expect(typeof xml).toBe('string');
      expect(xml!.length).toBeGreaterThan(0);
    });
  });

  describe('fromXML delegation', () => {
    it('delegates to NCPDPSerializer.fromXML', () => {
      const xml = '<NCPDP_D0_Request><TransactionHeaderRequest>' +
        '<BinNumber>123456</BinNumber>' +
        '<VersionReleaseNumber>D0</VersionReleaseNumber>' +
        '<TransactionCode>B1</TransactionCode>' +
        '<ProcessorControlNumber>PCN1234567</ProcessorControlNumber>' +
        '<TransactionCount>1</TransactionCount>' +
        '<ServiceProviderIdQualifier>01</ServiceProviderIdQualifier>' +
        '<ServiceProviderId>SP2345678901234</ServiceProviderId>' +
        '<DateOfService>20060101</DateOfService>' +
        '</TransactionHeaderRequest></NCPDP_D0_Request>';

      const result = adapter.fromXML(xml);
      expect(typeof result).toBe('string');
      expect(result!.length).toBeGreaterThan(0);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('returns a Map with mirth_ prefixed keys', () => {
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'Test';

      const metadata = adapter.getMetaDataFromMessage(message);

      expect(metadata).toBeInstanceOf(Map);
      // Keys should use mirth_ prefix
      expect(metadata.has(VERSION_VARIABLE_MAPPING)).toBe(true);
      expect(metadata.has(TYPE_VARIABLE_MAPPING)).toBe(true);

      // Should NOT have unprefixed keys
      expect(metadata.has('version')).toBe(false);
      expect(metadata.has('type')).toBe(false);
      expect(metadata.has('source')).toBe(false);
    });

    it('extracts version from message header', () => {
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'Test';

      const metadata = adapter.getMetaDataFromMessage(message);
      expect(metadata.get(VERSION_VARIABLE_MAPPING)).toBe('D0');
    });

    it('provides default version when extraction fails', () => {
      const metadata = adapter.getMetaDataFromMessage('');
      // Should still have version key (defaulted to 5.1)
      expect(metadata.get(VERSION_VARIABLE_MAPPING)).toBe('5.1');
    });
  });

  describe('populateMetaData', () => {
    it('populates map with mirth_ prefixed keys', () => {
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'Test';

      const map = new Map<string, unknown>();
      adapter.populateMetaData(message, map);
      expect(map.has(VERSION_VARIABLE_MAPPING)).toBe(true);
    });
  });

  describe('constructor with custom properties', () => {
    it('accepts custom serialization and deserialization properties', () => {
      const customAdapter = new NCPDPSerializerAdapter(
        { segmentDelimiter: '0x1E', groupDelimiter: '0x1D', fieldDelimiter: '0x1C' },
        { segmentDelimiter: '0x1E', groupDelimiter: '0x1D', fieldDelimiter: '0x1C', useStrictValidation: true }
      );
      expect(customAdapter.getDataType()).toBe('NCPDP');
    });
  });
});
