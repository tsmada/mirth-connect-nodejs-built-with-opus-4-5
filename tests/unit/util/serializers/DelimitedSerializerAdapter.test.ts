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

  test('getMetaDataFromMessage returns empty Map (Java DelimitedSerializer.populateMetaData is a no-op)', () => {
    const metadata = adapter.getMetaDataFromMessage('a,b,c');
    expect(metadata).toBeInstanceOf(Map);
    expect(metadata.size).toBe(0);
  });

  test('populateMetaData is a no-op (matches Java DelimitedSerializer)', () => {
    const map = new Map<string, unknown>();
    adapter.populateMetaData('a,b,c', map);
    expect(map.size).toBe(0);
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
