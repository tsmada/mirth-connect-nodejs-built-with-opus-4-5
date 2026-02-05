import { ComparisonResult, Difference } from './MessageComparator';

export interface DICOMComparisonOptions {
  ignoreTimestamps?: boolean;
  ignoreInstanceUIDs?: boolean;
  ignoredTags?: string[];
  requiredTags?: string[];
}

const DEFAULT_OPTIONS: DICOMComparisonOptions = {
  ignoreTimestamps: true,
  ignoreInstanceUIDs: true,
  ignoredTags: [
    '00080012', // Instance Creation Date
    '00080013', // Instance Creation Time
    '00080018', // SOP Instance UID
    '0020000E', // Series Instance UID (sometimes)
  ],
  requiredTags: [
    '00100010', // Patient Name
    '00100020', // Patient ID
    '00080060', // Modality
    '0020000D', // Study Instance UID
  ],
};

// DICOM tag definitions for display
const TAG_NAMES: Record<string, string> = {
  '00100010': 'PatientName',
  '00100020': 'PatientID',
  '00100030': 'PatientBirthDate',
  '00100040': 'PatientSex',
  '0020000D': 'StudyInstanceUID',
  '0020000E': 'SeriesInstanceUID',
  '00080016': 'SOPClassUID',
  '00080018': 'SOPInstanceUID',
  '00080020': 'StudyDate',
  '00080030': 'StudyTime',
  '00080060': 'Modality',
  '00080070': 'Manufacturer',
  '00081030': 'StudyDescription',
  '00280010': 'Rows',
  '00280011': 'Columns',
  '00280100': 'BitsAllocated',
  '00280101': 'BitsStored',
};

interface DICOMElement {
  vr: string;
  Value?: unknown[];
}

type DICOMDataset = Record<string, DICOMElement>;

/**
 * Comparator for DICOM metadata.
 * Compares DICOM JSON representation of datasets.
 */
export class DICOMComparator {
  private options: DICOMComparisonOptions;

  constructor(options: DICOMComparisonOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Compare two DICOM datasets (in JSON format)
   */
  compare(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    try {
      const ds1 = JSON.parse(expected) as DICOMDataset;
      const ds2 = JSON.parse(actual) as DICOMDataset;

      this.compareDatasets(ds1, ds2, differences);

      const match = differences.length === 0;
      return {
        match,
        differences,
        summary: match
          ? 'DICOM datasets match'
          : `Found ${differences.length} difference(s)`,
      };
    } catch (error) {
      return {
        match: false,
        differences: [
          {
            path: 'parse',
            type: 'changed',
            description: `Parse error: ${(error as Error).message}`,
          },
        ],
        summary: 'Failed to parse DICOM JSON',
      };
    }
  }

  /**
   * Extract patient and study info from DICOM dataset
   */
  extractPatientStudyInfo(
    dicomJson: string
  ): {
    patientId?: string;
    patientName?: string;
    studyInstanceUID?: string;
    modality?: string;
  } {
    try {
      const ds = JSON.parse(dicomJson) as DICOMDataset;
      return {
        patientId: this.extractValue(ds, '00100020'),
        patientName: this.extractPersonName(ds, '00100010'),
        studyInstanceUID: this.extractValue(ds, '0020000D'),
        modality: this.extractValue(ds, '00080060'),
      };
    } catch {
      return {};
    }
  }

  /**
   * Validate that required tags are present
   */
  validateRequiredTags(dicomJson: string): ComparisonResult {
    const differences: Difference[] = [];

    try {
      const ds = JSON.parse(dicomJson) as DICOMDataset;

      for (const tag of this.options.requiredTags || []) {
        if (!ds[tag] || !ds[tag].Value || ds[tag].Value.length === 0) {
          differences.push({
            path: tag,
            type: 'removed',
            description: `Required tag ${this.getTagName(tag)} (${tag}) is missing or empty`,
          });
        }
      }

      const match = differences.length === 0;
      return {
        match,
        differences,
        summary: match
          ? 'All required DICOM tags present'
          : `Missing ${differences.length} required tag(s)`,
      };
    } catch (error) {
      return {
        match: false,
        differences: [
          {
            path: 'parse',
            type: 'changed',
            description: `Parse error: ${(error as Error).message}`,
          },
        ],
        summary: 'Failed to parse DICOM JSON',
      };
    }
  }

  private compareDatasets(
    ds1: DICOMDataset,
    ds2: DICOMDataset,
    differences: Difference[]
  ): void {
    const allTags = new Set([...Object.keys(ds1), ...Object.keys(ds2)]);

    for (const tag of allTags) {
      // Skip ignored tags
      if (this.options.ignoredTags?.includes(tag)) {
        continue;
      }

      // Skip timestamp tags if configured
      if (this.options.ignoreTimestamps && this.isTimestampTag(tag)) {
        continue;
      }

      // Skip instance UIDs if configured
      if (this.options.ignoreInstanceUIDs && this.isInstanceUIDTag(tag)) {
        continue;
      }

      const elem1 = ds1[tag];
      const elem2 = ds2[tag];

      if (!elem1) {
        differences.push({
          path: this.getTagName(tag),
          type: 'added',
          actual: this.formatValue(elem2),
          description: `Tag ${this.getTagName(tag)} (${tag}) added`,
        });
        continue;
      }

      if (!elem2) {
        differences.push({
          path: this.getTagName(tag),
          type: 'removed',
          expected: this.formatValue(elem1),
          description: `Tag ${this.getTagName(tag)} (${tag}) removed`,
        });
        continue;
      }

      // Compare VR
      if (elem1.vr !== elem2.vr) {
        differences.push({
          path: `${this.getTagName(tag)}.vr`,
          type: 'changed',
          expected: elem1.vr,
          actual: elem2.vr,
          description: `VR mismatch for ${this.getTagName(tag)}`,
        });
      }

      // Compare values
      if (!this.valuesEqual(elem1.Value, elem2.Value)) {
        differences.push({
          path: this.getTagName(tag),
          type: 'changed',
          expected: this.formatValue(elem1),
          actual: this.formatValue(elem2),
          description: `Value differs for ${this.getTagName(tag)}`,
        });
      }
    }
  }

  private isTimestampTag(tag: string): boolean {
    // Date (DA), Time (TM), DateTime (DT) tags
    const timestampTags = [
      '00080012', '00080013', '00080020', '00080021', '00080022', '00080023',
      '00080030', '00080031', '00080032', '00080033',
    ];
    return timestampTags.includes(tag);
  }

  private isInstanceUIDTag(tag: string): boolean {
    // SOP Instance UID, Series Instance UID, etc.
    return tag === '00080018' || tag === '0020000E';
  }

  private valuesEqual(val1?: unknown[], val2?: unknown[]): boolean {
    if (!val1 && !val2) return true;
    if (!val1 || !val2) return false;
    if (val1.length !== val2.length) return false;

    for (let i = 0; i < val1.length; i++) {
      if (JSON.stringify(val1[i]) !== JSON.stringify(val2[i])) {
        return false;
      }
    }
    return true;
  }

  private extractValue(ds: DICOMDataset, tag: string): string | undefined {
    const elem = ds[tag];
    if (!elem || !elem.Value || elem.Value.length === 0) return undefined;
    return String(elem.Value[0]);
  }

  private extractPersonName(ds: DICOMDataset, tag: string): string | undefined {
    const elem = ds[tag];
    if (!elem || !elem.Value || elem.Value.length === 0) return undefined;
    const pn = elem.Value[0] as { Alphabetic?: string };
    return pn?.Alphabetic;
  }

  private formatValue(elem: DICOMElement): string {
    if (!elem.Value || elem.Value.length === 0) return '(empty)';
    if (elem.Value.length === 1) {
      const val = elem.Value[0];
      if (typeof val === 'object') {
        return JSON.stringify(val);
      }
      return String(val);
    }
    return JSON.stringify(elem.Value);
  }

  private getTagName(tag: string): string {
    return TAG_NAMES[tag] || tag;
  }
}
