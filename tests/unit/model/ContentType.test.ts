import {
  ContentType,
  CONTENT_TYPE_DESCRIPTIONS,
  parseContentType,
  ERROR_CODES,
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
      expect(ContentType.RESPONSE_ERROR).toBe(14);
      expect(ContentType.SOURCE_MAP).toBe(15);
    });

    it('should have 15 content types', () => {
      // Filter to only numeric values (enum has both keys and values)
      const numericValues = Object.values(ContentType).filter(
        (v) => typeof v === 'number'
      );
      expect(numericValues.length).toBe(15);
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
      expect(parseContentType(14)).toBe(ContentType.RESPONSE_ERROR);
      expect(parseContentType(15)).toBe(ContentType.SOURCE_MAP);
    });

    it('should throw for invalid content type IDs', () => {
      expect(() => parseContentType(0)).toThrow('Unknown content type ID: 0');
      expect(() => parseContentType(16)).toThrow('Unknown content type ID: 16');
      expect(() => parseContentType(-1)).toThrow('Unknown content type ID: -1');
    });
  });

  describe('ERROR_CODES', () => {
    it('should have correct bitmask values matching Java ErrorConstants', () => {
      expect(ERROR_CODES.PROCESSING_ERROR).toBe(1);
      expect(ERROR_CODES.POSTPROCESSOR_ERROR).toBe(2);
      expect(ERROR_CODES.RESPONSE_ERROR).toBe(4);
    });
  });
});
