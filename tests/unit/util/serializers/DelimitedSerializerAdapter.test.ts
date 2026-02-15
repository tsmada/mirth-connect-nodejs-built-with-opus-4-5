import { DelimitedSerializerAdapter } from '../../../../src/util/serializers/DelimitedSerializerAdapter.js';

describe('DelimitedSerializerAdapter', () => {
  let adapter: DelimitedSerializerAdapter;

  beforeEach(() => {
    adapter = new DelimitedSerializerAdapter();
  });

  test('getDataType returns DELIMITED', () => {
    expect(adapter.getDataType()).toBe('DELIMITED');
  });

  test('isSerializationRequired returns false with defaults', () => {
    expect(adapter.isSerializationRequired()).toBe(false);
    expect(adapter.isSerializationRequired(true)).toBe(false);
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('toXML converts comma-delimited data to XML', () => {
    const csv = 'name,age,city\nAlice,30,Boston\nBob,25,NYC';
    const xml = adapter.toXML(csv);
    expect(xml).not.toBeNull();
    expect(xml).toContain('<delimited>');
    expect(xml).toContain('Alice');
    expect(xml).toContain('Bob');
  });

  test('fromXML converts XML back to delimited', () => {
    // First convert to XML, then back
    const csv = 'Alice,30,Boston';
    const xml = adapter.toXML(csv);
    expect(xml).not.toBeNull();
    const result = adapter.fromXML(xml!);
    expect(result).not.toBeNull();
    expect(result).toContain('Alice');
    expect(result).toContain('30');
    expect(result).toContain('Boston');
  });

  test('getMetaDataFromMessage returns mirth_type: delimited', () => {
    const metadata = adapter.getMetaDataFromMessage('a,b,c');
    expect(metadata.get('mirth_type')).toBe('delimited');
    expect(metadata.get('mirth_version')).toBe('');
    // Must use mirth_ prefix, NOT bare 'type'
    expect(metadata.has('type')).toBe(false);
  });

  test('populateMetaData writes mirth_type to map', () => {
    const map = new Map<string, unknown>();
    adapter.populateMetaData('a,b,c', map);
    expect(map.get('mirth_type')).toBe('delimited');
    expect(map.get('mirth_version')).toBe('');
  });

  test('toJSON returns null (not supported)', () => {
    expect(adapter.toJSON('a,b,c')).toBeNull();
  });

  test('fromJSON returns null (not supported)', () => {
    expect(adapter.fromJSON('{}')).toBeNull();
  });

  test('transformWithoutSerializing returns null', () => {
    expect(adapter.transformWithoutSerializing('a,b,c')).toBeNull();
  });
});
