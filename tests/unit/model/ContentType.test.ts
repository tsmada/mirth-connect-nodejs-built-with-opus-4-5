import {
  ContentType,
  CONTENT_TYPE_DESCRIPTIONS,
  parseContentType,
} from '../../../src/model/ContentType';

describe('ContentType', () => {
  describe('ContentType enum values', () => {
    it('should have correct numeric values', () => {
      expect(ContentType.RAW).toBe(1);
      expect(ContentType.PROCESSED_RAW).toBe(2);
      expect(ContentType.TRANSFORMED).toBe(3);
      expect(ContentType.ENCODED).toBe(4);
      expect(ContentType.SENT).toBe(5);
      expect(ContentType.RESPONSE).toBe(6);
      expect(ContentType.RESPONSE_TRANSFORMED).toBe(7);
      expect(ContentType.PROCESSED_RESPONSE).toBe(8);
      expect(ContentType.CONNECTOR_MAP).toBe(9);
      expect(ContentType.CHANNEL_MAP).toBe(10);
      expect(ContentType.RESPONSE_MAP).toBe(11);
      expect(ContentType.PROCESSING_ERROR).toBe(12);
      expect(ContentType.POSTPROCESSOR_ERROR).toBe(13);
      expect(ContentType.SOURCE_MAP).toBe(14);
    });

    it('should have 14 content types', () => {
      // Filter to only numeric values (enum has both keys and values)
      const numericValues = Object.values(ContentType).filter(
        (v) => typeof v === 'number'
      );
      expect(numericValues.length).toBe(14);
    });
  });

  describe('CONTENT_TYPE_DESCRIPTIONS', () => {
    it('should have descriptions for all content types', () => {
      const numericValues = Object.values(ContentType).filter(
        (v): v is ContentType => typeof v === 'number'
      );

      for (const contentType of numericValues) {
        expect(CONTENT_TYPE_DESCRIPTIONS[contentType]).toBeDefined();
        expect(typeof CONTENT_TYPE_DESCRIPTIONS[contentType]).toBe('string');
      }
    });
  });

  describe('parseContentType', () => {
    it('should parse valid content type IDs', () => {
      expect(parseContentType(1)).toBe(ContentType.RAW);
      expect(parseContentType(3)).toBe(ContentType.TRANSFORMED);
      expect(parseContentType(6)).toBe(ContentType.RESPONSE);
      expect(parseContentType(14)).toBe(ContentType.SOURCE_MAP);
    });

    it('should throw for invalid content type IDs', () => {
      expect(() => parseContentType(0)).toThrow('Unknown content type ID: 0');
      expect(() => parseContentType(15)).toThrow('Unknown content type ID: 15');
      expect(() => parseContentType(-1)).toThrow('Unknown content type ID: -1');
    });
  });
});
