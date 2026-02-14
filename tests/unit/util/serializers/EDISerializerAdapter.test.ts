import { EDISerializerAdapter } from '../../../../src/util/serializers/EDISerializerAdapter.js';

const SAMPLE_EDI =
  'ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *210101*1200*^*00501*000000001*0*P*:~' +
  'GS*HP*SENDER*RECEIVER*20210101*1200*1*X*005010X279A1~' +
  'ST*270*0001~' +
  'SE*2*0001~' +
  'GE*1*1~' +
  'IEA*1*000000001~';

describe('EDISerializerAdapter', () => {
  let adapter: EDISerializerAdapter;

  beforeEach(() => {
    adapter = new EDISerializerAdapter();
  });

  test('getDataType returns EDI/X12', () => {
    expect(adapter.getDataType()).toBe('EDI/X12');
  });

  test('isSerializationRequired returns false', () => {
    expect(adapter.isSerializationRequired()).toBe(false);
    expect(adapter.isSerializationRequired(true)).toBe(false);
  });

  test('toXML converts EDI to XML', () => {
    const xml = adapter.toXML(SAMPLE_EDI);
    expect(xml).not.toBeNull();
    expect(xml).toContain('ISA');
    expect(xml).toContain('GS');
    expect(xml).toContain('ST');
  });

  test('fromXML converts XML back to EDI', () => {
    const xml = adapter.toXML(SAMPLE_EDI);
    expect(xml).not.toBeNull();
    const result = adapter.fromXML(xml!);
    expect(result).not.toBeNull();
    // Should contain segment names
    expect(result).toContain('ISA');
    expect(result).toContain('GS');
    expect(result).toContain('ST');
  });

  test('getMetaDataFromMessage extracts mirth_source, mirth_type, mirth_version', () => {
    const metadata = adapter.getMetaDataFromMessage(SAMPLE_EDI);

    // ISA.06 = SENDER (trimmed)
    expect(metadata.get('mirth_source')).toBe('SENDER');
    // ST.01 = 270
    expect(metadata.get('mirth_type')).toBe('270');
    // GS.08 = 005010X279A1
    expect(metadata.get('mirth_version')).toBe('005010X279A1');

    // Must NOT use bare keys
    expect(metadata.has('source')).toBe(false);
    expect(metadata.has('type')).toBe(false);
    expect(metadata.has('version')).toBe(false);
  });

  test('populateMetaData writes mirth_ prefixed keys', () => {
    const map = new Map<string, unknown>();
    adapter.populateMetaData(SAMPLE_EDI, map);

    expect(map.get('mirth_source')).toBe('SENDER');
    expect(map.get('mirth_type')).toBe('270');
    expect(map.get('mirth_version')).toBe('005010X279A1');
  });

  test('transformWithoutSerializing returns null', () => {
    expect(adapter.transformWithoutSerializing(SAMPLE_EDI)).toBeNull();
  });

  test('toJSON returns null (not supported)', () => {
    expect(adapter.toJSON(SAMPLE_EDI)).toBeNull();
  });

  test('fromJSON returns null (not supported)', () => {
    expect(adapter.fromJSON('{}')).toBeNull();
  });
});
