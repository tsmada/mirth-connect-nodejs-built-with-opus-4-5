import { HL7V3SerializerAdapter } from '../../../../src/util/serializers/HL7V3SerializerAdapter.js';

const SAMPLE_HL7V3 = `<?xml version="1.0" encoding="UTF-8"?>
<PRPA_IN201301UV02 xmlns="urn:hl7-org:v3" ITSVersion="XML_1.0">
  <id root="2.16.840.1.113883.19.1122.7" extension="CNTRL-3456"/>
  <creationTime value="20070428150301"/>
  <interactionId root="2.16.840.1.113883.1.6" extension="PRPA_IN201301UV02"/>
  <processingCode code="P"/>
</PRPA_IN201301UV02>`;

const SIMPLE_HL7V3 = '<ClinicalDocument><id root="1.2.3"/></ClinicalDocument>';

describe('HL7V3SerializerAdapter', () => {
  let adapter: HL7V3SerializerAdapter;

  beforeEach(() => {
    adapter = new HL7V3SerializerAdapter();
  });

  test('getDataType returns HL7V3', () => {
    expect(adapter.getDataType()).toBe('HL7V3');
  });

  test('isSerializationRequired returns false', () => {
    expect(adapter.isSerializationRequired()).toBe(false);
    expect(adapter.isSerializationRequired(true)).toBe(false);
    expect(adapter.isSerializationRequired(false)).toBe(false);
  });

  test('toXML is pass-through (trims whitespace)', () => {
    const result = adapter.toXML(SIMPLE_HL7V3);
    expect(result).toBe(SIMPLE_HL7V3);
  });

  test('toXML with stripNamespaces removes xmlns declarations', () => {
    const nsAdapter = new HL7V3SerializerAdapter({ stripNamespaces: true });
    const result = nsAdapter.toXML(SAMPLE_HL7V3);
    expect(result).not.toContain('xmlns');
    expect(result).toContain('PRPA_IN201301UV02');
  });

  test('fromXML is pass-through', () => {
    const result = adapter.fromXML(SIMPLE_HL7V3);
    expect(result).toBe(SIMPLE_HL7V3);
  });

  test('getMetaDataFromMessage returns empty Map (Java HL7V3Serializer.populateMetaData is a no-op)', () => {
    const metadata = adapter.getMetaDataFromMessage(SAMPLE_HL7V3);
    expect(metadata).toBeInstanceOf(Map);
    expect(metadata.size).toBe(0);
  });

  test('populateMetaData is a no-op (matches Java HL7V3Serializer)', () => {
    const map = new Map<string, unknown>();
    adapter.populateMetaData(SAMPLE_HL7V3, map);
    expect(map.size).toBe(0);
  });

  test('transformWithoutSerializing returns null by default', () => {
    expect(adapter.transformWithoutSerializing(SAMPLE_HL7V3)).toBeNull();
  });

  test('transformWithoutSerializing strips namespaces when enabled', () => {
    const nsAdapter = new HL7V3SerializerAdapter({ stripNamespaces: true });
    const result = nsAdapter.transformWithoutSerializing(SAMPLE_HL7V3);
    expect(result).not.toBeNull();
    expect(result).not.toContain('xmlns');
  });

  test('toJSON returns null (not supported)', () => {
    expect(adapter.toJSON(SAMPLE_HL7V3)).toBeNull();
  });

  test('fromJSON returns null (not supported)', () => {
    expect(adapter.fromJSON('{}')).toBeNull();
  });
});
