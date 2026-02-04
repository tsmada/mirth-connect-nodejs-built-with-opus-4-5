/**
 * Tests for DICOMDataTypeProperties
 */

import {
  DicomTag,
  getDefaultDICOMDataTypeProperties,
  formatTag,
  parseTag,
} from '../../../../src/datatypes/dicom/DICOMDataTypeProperties.js';

describe('DICOMDataTypeProperties', () => {
  describe('getDefaultDICOMDataTypeProperties', () => {
    it('should return empty properties', () => {
      const props = getDefaultDICOMDataTypeProperties();

      expect(props).toBeDefined();
      expect(Object.keys(props)).toHaveLength(0);
    });
  });

  describe('DicomTag', () => {
    it('should have correct patient module tags', () => {
      expect(DicomTag.PATIENT_NAME).toEqual({ group: 0x0010, element: 0x0010 });
      expect(DicomTag.PATIENT_ID).toEqual({ group: 0x0010, element: 0x0020 });
      expect(DicomTag.PATIENT_BIRTH_DATE).toEqual({ group: 0x0010, element: 0x0030 });
      expect(DicomTag.PATIENT_SEX).toEqual({ group: 0x0010, element: 0x0040 });
    });

    it('should have correct study module tags', () => {
      expect(DicomTag.STUDY_INSTANCE_UID).toEqual({ group: 0x0020, element: 0x000D });
      expect(DicomTag.STUDY_DATE).toEqual({ group: 0x0008, element: 0x0020 });
      expect(DicomTag.STUDY_TIME).toEqual({ group: 0x0008, element: 0x0030 });
      expect(DicomTag.ACCESSION_NUMBER).toEqual({ group: 0x0008, element: 0x0050 });
    });

    it('should have correct series module tags', () => {
      expect(DicomTag.SERIES_INSTANCE_UID).toEqual({ group: 0x0020, element: 0x000E });
      expect(DicomTag.MODALITY).toEqual({ group: 0x0008, element: 0x0060 });
    });

    it('should have correct instance module tags', () => {
      expect(DicomTag.SOP_CLASS_UID).toEqual({ group: 0x0008, element: 0x0016 });
      expect(DicomTag.SOP_INSTANCE_UID).toEqual({ group: 0x0008, element: 0x0018 });
    });

    it('should have image module tags', () => {
      expect(DicomTag.ROWS).toEqual({ group: 0x0028, element: 0x0010 });
      expect(DicomTag.COLUMNS).toEqual({ group: 0x0028, element: 0x0011 });
      expect(DicomTag.PIXEL_DATA).toEqual({ group: 0x7FE0, element: 0x0010 });
    });
  });

  describe('formatTag', () => {
    it('should format tag as hex string', () => {
      expect(formatTag(0x0010, 0x0010)).toBe('00100010');
      expect(formatTag(0x0008, 0x0016)).toBe('00080016');
      expect(formatTag(0x7FE0, 0x0010)).toBe('7FE00010');
    });

    it('should pad with zeros', () => {
      expect(formatTag(0x08, 0x16)).toBe('00080016');
      expect(formatTag(0x0, 0x0)).toBe('00000000');
    });
  });

  describe('parseTag', () => {
    it('should parse 8-character hex string', () => {
      expect(parseTag('00100010')).toEqual({ group: 0x0010, element: 0x0010 });
      expect(parseTag('7FE00010')).toEqual({ group: 0x7FE0, element: 0x0010 });
    });

    it('should parse tag with parentheses', () => {
      expect(parseTag('(0010,0010)')).toEqual({ group: 0x0010, element: 0x0010 });
      expect(parseTag('(0008,0016)')).toEqual({ group: 0x0008, element: 0x0016 });
    });

    it('should parse tag with comma', () => {
      expect(parseTag('0010,0010')).toEqual({ group: 0x0010, element: 0x0010 });
    });

    it('should return null for invalid tag', () => {
      expect(parseTag('invalid')).toBeNull();
      expect(parseTag('001')).toBeNull();
      expect(parseTag('XXXXXXXX')).toBeNull();
    });
  });
});
