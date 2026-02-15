/**
 * Parity tests for Delimited and NCPDP serializer adapters.
 *
 * Validates isSerializationRequired behavior and metadata extraction
 * match Java Mirth's DelimitedSerializer.java and NCPDPSerializer.java.
 */
import { DelimitedSerializerAdapter } from '../../../../src/util/serializers/DelimitedSerializerAdapter.js';
import { NCPDPSerializerAdapter } from '../../../../src/util/serializers/NCPDPSerializerAdapter.js';
import {
  TYPE_VARIABLE_MAPPING,
  VERSION_VARIABLE_MAPPING,
} from '../../../../src/model/DefaultMetaData.js';

describe('Delimited isSerializationRequired parity (SPC-W3-008)', () => {
  test('returns false with default/empty properties', () => {
    const adapter = new DelimitedSerializerAdapter();
    expect(adapter.isSerializationRequired()).toBe(false);
    expect(adapter.isSerializationRequired(true)).toBe(false);
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('returns true with custom columnDelimiter', () => {
    const adapter = new DelimitedSerializerAdapter(
      { columnDelimiter: '|' },
      { columnDelimiter: '|' }
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    expect(adapter.isSerializationRequired(false)).toBe(true);
  });

  test('returns true with columnWidths set (toXml=true)', () => {
    const adapter = new DelimitedSerializerAdapter(
      { columnWidths: [10, 20, 30] },
      {}
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    // columnWidths not set in deserialization props
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('returns true with numberedRows=true (toXml only)', () => {
    const adapter = new DelimitedSerializerAdapter(
      { numberedRows: true },
      {}
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    // numberedRows is only checked in toXml direction (serialization)
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('returns true with columnNames set (toXml only)', () => {
    const adapter = new DelimitedSerializerAdapter(
      { columnNames: ['name', 'age'] },
      {}
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    // columnNames is only checked in toXml direction
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('returns true with ignoreCR=false (toXml only)', () => {
    const adapter = new DelimitedSerializerAdapter(
      { ignoreCR: false },
      {}
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('returns true with custom quoteToken', () => {
    const adapter = new DelimitedSerializerAdapter(
      { quoteToken: "'" },
      { quoteToken: "'" }
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    expect(adapter.isSerializationRequired(false)).toBe(true);
  });

  test('returns true with escapeWithDoubleQuote=false', () => {
    const adapter = new DelimitedSerializerAdapter(
      { escapeWithDoubleQuote: false },
      { escapeWithDoubleQuote: false }
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    expect(adapter.isSerializationRequired(false)).toBe(true);
  });

  test('returns true with custom recordDelimiter', () => {
    const adapter = new DelimitedSerializerAdapter(
      { recordDelimiter: '\\r\\n' },
      { recordDelimiter: '\\r\\n' }
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    expect(adapter.isSerializationRequired(false)).toBe(true);
  });

  test('checks toXml=true vs toXml=false independently', () => {
    // Only serialization props differ (columnNames set), deserialization is default
    const adapter = new DelimitedSerializerAdapter(
      { columnNames: ['a', 'b'] },
      {}
    );
    expect(adapter.isSerializationRequired(true)).toBe(true);
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });
});

describe('Delimited metadata parity (SPC-W3-009)', () => {
  test('populateMetaData sets mirth_type to delimited (lowercase)', () => {
    const adapter = new DelimitedSerializerAdapter();
    const map = new Map<string, unknown>();
    adapter.populateMetaData('a,b,c', map);
    expect(map.get(TYPE_VARIABLE_MAPPING)).toBe('delimited');
  });

  test('populateMetaData sets mirth_version to empty string', () => {
    const adapter = new DelimitedSerializerAdapter();
    const map = new Map<string, unknown>();
    adapter.populateMetaData('a,b,c', map);
    expect(map.get(VERSION_VARIABLE_MAPPING)).toBe('');
  });

  test('getMetaDataFromMessage returns both mirth_type and mirth_version', () => {
    const adapter = new DelimitedSerializerAdapter();
    const metadata = adapter.getMetaDataFromMessage('a,b,c');
    expect(metadata.get(TYPE_VARIABLE_MAPPING)).toBe('delimited');
    expect(metadata.get(VERSION_VARIABLE_MAPPING)).toBe('');
    expect(metadata.size).toBe(2);
  });
});

describe('NCPDP isSerializationRequired parity (SPC-W3-010)', () => {
  test('returns false with default properties', () => {
    const adapter = new NCPDPSerializerAdapter();
    expect(adapter.isSerializationRequired()).toBe(false);
  });

  test('returns false with toXml=true even when useStrictValidation=true', () => {
    const adapter = new NCPDPSerializerAdapter(
      {},
      { useStrictValidation: true }
    );
    expect(adapter.isSerializationRequired(true)).toBe(false);
  });

  test('returns false with toXml=undefined even when useStrictValidation=true', () => {
    const adapter = new NCPDPSerializerAdapter(
      {},
      { useStrictValidation: true }
    );
    expect(adapter.isSerializationRequired()).toBe(false);
  });

  test('returns true with toXml=false and useStrictValidation=true', () => {
    const adapter = new NCPDPSerializerAdapter(
      {},
      { useStrictValidation: true }
    );
    expect(adapter.isSerializationRequired(false)).toBe(true);
  });

  test('returns false with toXml=false and useStrictValidation=false', () => {
    const adapter = new NCPDPSerializerAdapter(
      {},
      { useStrictValidation: false }
    );
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('returns false with toXml=false and no useStrictValidation property', () => {
    const adapter = new NCPDPSerializerAdapter({}, {});
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });
});
