/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/plugins/datatypes/dicom/DICOMDataTypeProperties.java
 *
 * Purpose: Properties for DICOM data type
 *
 * DICOM data type is relatively simple - it's primarily a container for binary DICOM data
 * that gets Base64 encoded for transport through Mirth channels.
 */

/**
 * DICOM Data Type Properties
 *
 * Note: The Java implementation has mostly empty migration methods and no specific properties.
 * DICOM data handling is done primarily through the serializer.
 */
export interface DICOMDataTypeProperties {
  // Currently no specific properties for DICOM data type
  // This interface exists for future extensibility and API compatibility
}

/**
 * Default DICOM Data Type properties
 */
export function getDefaultDICOMDataTypeProperties(): DICOMDataTypeProperties {
  return {};
}

/**
 * DICOM metadata
 */
export interface DICOMMetaData {
  /** Data type name */
  type: 'DICOM';
  /** Version (typically empty for DICOM) */
  version: string;
  /** SOP Class UID if available */
  sopClassUid?: string;
  /** SOP Instance UID if available */
  sopInstanceUid?: string;
  /** Patient Name */
  patientName?: string;
  /** Patient ID */
  patientId?: string;
  /** Study Instance UID */
  studyInstanceUid?: string;
  /** Series Instance UID */
  seriesInstanceUid?: string;
  /** Modality (CT, MR, US, etc.) */
  modality?: string;
}

/**
 * DICOM Tag definitions for common attributes
 */
export const DicomTag = {
  // Patient Module
  PATIENT_NAME: { group: 0x0010, element: 0x0010 },
  PATIENT_ID: { group: 0x0010, element: 0x0020 },
  PATIENT_BIRTH_DATE: { group: 0x0010, element: 0x0030 },
  PATIENT_SEX: { group: 0x0010, element: 0x0040 },

  // Study Module
  STUDY_INSTANCE_UID: { group: 0x0020, element: 0x000D },
  STUDY_DATE: { group: 0x0008, element: 0x0020 },
  STUDY_TIME: { group: 0x0008, element: 0x0030 },
  STUDY_DESCRIPTION: { group: 0x0008, element: 0x1030 },
  ACCESSION_NUMBER: { group: 0x0008, element: 0x0050 },

  // Series Module
  SERIES_INSTANCE_UID: { group: 0x0020, element: 0x000E },
  SERIES_NUMBER: { group: 0x0020, element: 0x0011 },
  SERIES_DESCRIPTION: { group: 0x0008, element: 0x103E },
  MODALITY: { group: 0x0008, element: 0x0060 },

  // Instance Module
  SOP_CLASS_UID: { group: 0x0008, element: 0x0016 },
  SOP_INSTANCE_UID: { group: 0x0008, element: 0x0018 },
  INSTANCE_NUMBER: { group: 0x0020, element: 0x0013 },

  // Image Module
  ROWS: { group: 0x0028, element: 0x0010 },
  COLUMNS: { group: 0x0028, element: 0x0011 },
  BITS_ALLOCATED: { group: 0x0028, element: 0x0100 },
  BITS_STORED: { group: 0x0028, element: 0x0101 },
  PIXEL_DATA: { group: 0x7FE0, element: 0x0010 },

  // Transfer Syntax
  TRANSFER_SYNTAX_UID: { group: 0x0002, element: 0x0010 },
  MEDIA_STORAGE_SOP_CLASS_UID: { group: 0x0002, element: 0x0002 },
  MEDIA_STORAGE_SOP_INSTANCE_UID: { group: 0x0002, element: 0x0003 },
} as const;

/**
 * Format a DICOM tag as hex string (e.g., "00100010")
 */
export function formatTag(group: number, element: number): string {
  return (
    group.toString(16).padStart(4, '0') +
    element.toString(16).padStart(4, '0')
  ).toUpperCase();
}

/**
 * Parse a DICOM tag string to group/element numbers
 */
export function parseTag(tagStr: string): { group: number; element: number } | null {
  // Handle formats: "00100010", "(0010,0010)", "0010,0010"
  const cleaned = tagStr.replace(/[(),\s]/g, '');

  if (cleaned.length !== 8) {
    return null;
  }

  const group = parseInt(cleaned.substring(0, 4), 16);
  const element = parseInt(cleaned.substring(4, 8), 16);

  if (isNaN(group) || isNaN(element)) {
    return null;
  }

  return { group, element };
}
