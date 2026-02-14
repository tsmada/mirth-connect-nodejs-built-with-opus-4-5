import { NCPDPSerializerAdapter } from '../../../../src/util/serializers/NCPDPSerializerAdapter.js';
import {
  SOURCE_VARIABLE_MAPPING,
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
  });

  describe('toXML delegation', () => {
    it('delegates to NCPDPSerializer.toXML', () => {
      // Build a minimal NCPDP message with segment/field delimiters
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      // Header (56 chars for request) + segment delimiter + field + segment ID + field value
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'TestField';

      const xml = adapter.toXML(message);
      // Should produce XML output (NCPDPReader wraps in XML tags)
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(0);
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
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('getMetaDataFromMessage', () => {
    it('translates metadata keys to mirth_ prefix', () => {
      // Build an NCPDP request message with enough header data for metadata extraction
      // Request header layout: BIN(6) + Version(2) + TransCode(2) + PCN(10) + Count(1) + SPIdQual(2) + SPId(15) + DOS(8)
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'Test';

      const metadata = adapter.getMetaDataFromMessage(message);

      // Keys should use mirth_ prefix
      expect(metadata).toHaveProperty(VERSION_VARIABLE_MAPPING);
      expect(metadata).toHaveProperty(TYPE_VARIABLE_MAPPING);
      expect(metadata).toHaveProperty(SOURCE_VARIABLE_MAPPING);

      // Should NOT have unprefixed keys
      expect(metadata).not.toHaveProperty('version');
      expect(metadata).not.toHaveProperty('type');
      expect(metadata).not.toHaveProperty('source');
    });

    it('extracts version from message header', () => {
      const segDel = String.fromCharCode(0x1e);
      const fldDel = String.fromCharCode(0x1c);
      const header = '123456D0B1PCN1234567101SP23456789012345200601015678901234';
      const message = header + segDel + fldDel + 'AM' + fldDel + 'Test';

      const metadata = adapter.getMetaDataFromMessage(message);
      expect(metadata[VERSION_VARIABLE_MAPPING]).toBe('D0');
    });

    it('provides default version when extraction fails', () => {
      // Very short message — not enough data for header extraction
      const metadata = adapter.getMetaDataFromMessage('');
      // Should still have version key (defaulted)
      expect(metadata[VERSION_VARIABLE_MAPPING]).toBe('5.1');
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
