/**
 * Parity tests for HL7v2SerializerAdapter — Wave 3 fixes.
 *
 * SPC-W3-001: transformWithoutSerializing accepts optional outboundSerializer
 * SPC-W3-002: isSerializationRequired checks useStrictParser (not always true)
 * SPC-W3-003: HL7v2 deserialization defaults include segmentDelimiter
 * SPC-W3-006: validateMessageControlId defaults to true
 */

import { HL7v2SerializerAdapter } from '../../../../src/util/serializers/HL7v2SerializerAdapter.js';
import { SerializerFactory } from '../../../../src/util/SerializerFactory.js';
import { getDefaultHL7v2ResponseValidationProperties } from '../../../../src/datatypes/hl7v2/HL7v2ResponseValidationProperties.js';
import type { IMessageSerializer } from '../../../../src/util/SerializerBase.js';

describe('HL7v2SerializerAdapter parity tests', () => {
  describe('SPC-W3-001: transformWithoutSerializing outboundSerializer parameter', () => {
    it('accepts optional outboundSerializer parameter', () => {
      const serializer = new HL7v2SerializerAdapter();
      const outbound = SerializerFactory.getSerializer('XML')!;

      // Should not throw when called with outboundSerializer
      const result = serializer.transformWithoutSerializing('MSH|^~\\&|', outbound);
      expect(result).toBeNull(); // BaseSerializer default returns null
    });

    it('still works without outboundSerializer (backward compatible)', () => {
      const serializer = new HL7v2SerializerAdapter();
      const result = serializer.transformWithoutSerializing('MSH|^~\\&|');
      expect(result).toBeNull();
    });

    it('IMessageSerializer interface allows outboundSerializer', () => {
      const serializer: IMessageSerializer = new HL7v2SerializerAdapter();
      const outbound: IMessageSerializer = SerializerFactory.getSerializer('JSON')!;

      // TypeScript compilation verifies the interface accepts the parameter
      const result = serializer.transformWithoutSerializing('test', outbound);
      expect(result).toBeNull();
    });
  });

  describe('SPC-W3-002: isSerializationRequired checks useStrictParser', () => {
    it('returns false with default props (non-strict parser)', () => {
      const serializer = new HL7v2SerializerAdapter();
      expect(serializer.isSerializationRequired()).toBe(false);
    });

    it('returns true when serialization useStrictParser is true (toXml direction)', () => {
      const serializer = new HL7v2SerializerAdapter(
        { useStrictParser: true },
        { useStrictParser: false }
      );
      expect(serializer.isSerializationRequired(true)).toBe(true);
    });

    it('returns true when deserialization useStrictParser is true (fromXml direction)', () => {
      const serializer = new HL7v2SerializerAdapter(
        { useStrictParser: false },
        { useStrictParser: true }
      );
      expect(serializer.isSerializationRequired(false)).toBe(true);
    });

    it('returns false for toXml when only deserialization strict parser is set', () => {
      const serializer = new HL7v2SerializerAdapter(
        { useStrictParser: false },
        { useStrictParser: true }
      );
      expect(serializer.isSerializationRequired(true)).toBe(false);
    });

    it('returns false for fromXml when only serialization strict parser is set', () => {
      const serializer = new HL7v2SerializerAdapter(
        { useStrictParser: true },
        { useStrictParser: false }
      );
      expect(serializer.isSerializationRequired(false)).toBe(false);
    });

    it('undefined toXml defaults to serialization direction (toXml=true)', () => {
      const serializer = new HL7v2SerializerAdapter(
        { useStrictParser: true },
        { useStrictParser: false }
      );
      // undefined should behave like toXml=true
      expect(serializer.isSerializationRequired()).toBe(true);
      expect(serializer.isSerializationRequired(undefined)).toBe(true);
    });
  });

  describe('SPC-W3-003: HL7v2 deserialization defaults include segmentDelimiter', () => {
    it('default deserialization properties include segmentDelimiter', () => {
      const props = SerializerFactory.getDefaultDeserializationProperties('HL7V2');
      expect(props).not.toBeNull();
      expect(props!.segmentDelimiter).toBe('\\r');
    });

    it('segmentDelimiter matches Java default (backslash-r)', () => {
      const props = SerializerFactory.getDefaultDeserializationProperties('HL7V2');
      // Java: private String segmentDelimiter = "\\r";
      expect(props!.segmentDelimiter).toBe('\\r');
    });
  });

  describe('SPC-W3-006: validateMessageControlId defaults to true', () => {
    it('defaults to true matching Java HL7v2ResponseValidationProperties', () => {
      const props = getDefaultHL7v2ResponseValidationProperties();
      expect(props.validateMessageControlId).toBe(true);
    });

    it('other defaults remain unchanged', () => {
      const props = getDefaultHL7v2ResponseValidationProperties();
      expect(props.successfulACKCode).toBe('AA,CA');
      expect(props.errorACKCode).toBe('AE,CE');
      expect(props.rejectedACKCode).toBe('AR,CR');
      expect(props.originalMessageControlId).toBe('');
      expect(props.originalIdMapVariable).toBe('');
    });
  });
});
