import { XMLParser } from 'fast-xml-parser';
import { ComparisonResult, Difference } from './MessageComparator';

export interface HL7V3ComparisonOptions {
  ignoreWhitespace?: boolean;
  ignoreNamespacePrefix?: boolean;
  ignoreTimestamps?: boolean;
  ignoreIds?: boolean;
  timestampElements?: string[];
  idElements?: string[];
}

const DEFAULT_OPTIONS: HL7V3ComparisonOptions = {
  ignoreWhitespace: true,
  ignoreNamespacePrefix: true,
  ignoreTimestamps: true,
  ignoreIds: true,
  timestampElements: ['effectiveTime', 'time', 'birthTime', 'low', 'high'],
  idElements: ['id', 'setId', 'versionNumber'],
};

/**
 * Comparator for HL7v3 CDA documents.
 * Handles XML namespace normalization, timestamp ignoring, and structural comparison.
 */
export class HL7V3Comparator {
  private options: HL7V3ComparisonOptions;
  private xmlParser: XMLParser;

  constructor(options: HL7V3ComparisonOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: this.options.ignoreWhitespace ?? true,
      removeNSPrefix: this.options.ignoreNamespacePrefix ?? true,
    });
  }

  /**
   * Compare two HL7v3 CDA documents
   */
  compare(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    try {
      const doc1 = this.xmlParser.parse(expected);
      const doc2 = this.xmlParser.parse(actual);

      this.compareObjects(doc1, doc2, '', differences);

      const match = differences.length === 0;
      return {
        match,
        differences,
        summary: match
          ? 'HL7v3 documents match'
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
        summary: 'Failed to parse HL7v3 documents',
      };
    }
  }

  /**
   * Extract key clinical data from CDA for comparison
   */
  extractClinicalData(
    cdaXml: string
  ): {
    patientId?: string;
    patientName?: string;
    documentId?: string;
    sections: string[];
  } {
    try {
      const doc = this.xmlParser.parse(cdaXml);
      const cda = doc.ClinicalDocument || doc;

      const patientRole = cda?.recordTarget?.patientRole;
      const patient = patientRole?.patient;

      return {
        patientId: this.extractId(patientRole?.id),
        patientName: this.extractPatientName(patient?.name),
        documentId: this.extractId(cda?.id),
        sections: this.extractSectionTitles(cda?.component?.structuredBody),
      };
    } catch {
      return { sections: [] };
    }
  }

  private extractId(idElement: unknown): string | undefined {
    if (!idElement) return undefined;
    const id = Array.isArray(idElement) ? idElement[0] : idElement;
    return (id as Record<string, unknown>)?.['@_extension'] as string | undefined;
  }

  private extractPatientName(nameElement: unknown): string | undefined {
    if (!nameElement) return undefined;
    const name = Array.isArray(nameElement) ? nameElement[0] : nameElement;
    const n = name as Record<string, unknown>;
    const given = n?.given;
    const family = n?.family;
    const givenStr = Array.isArray(given) ? given.join(' ') : given;
    return `${givenStr || ''} ${family || ''}`.trim();
  }

  private extractSectionTitles(structuredBody: unknown): string[] {
    if (!structuredBody) return [];
    const body = structuredBody as Record<string, unknown>;
    const components = body?.component;
    if (!components) return [];

    const compArray = Array.isArray(components) ? components : [components];
    return compArray
      .map((c) => (c as Record<string, unknown>)?.section?.title)
      .filter(Boolean) as string[];
  }

  private compareObjects(
    obj1: unknown,
    obj2: unknown,
    path: string,
    differences: Difference[]
  ): void {
    // Handle nulls
    if (obj1 === null || obj1 === undefined) {
      if (obj2 !== null && obj2 !== undefined) {
        differences.push({
          path,
          type: 'added',
          actual: obj2,
          description: `Value added at ${path}`,
        });
      }
      return;
    }

    if (obj2 === null || obj2 === undefined) {
      differences.push({
        path,
        type: 'removed',
        expected: obj1,
        description: `Value removed at ${path}`,
      });
      return;
    }

    // Check if this is a timestamp or ID field to ignore
    const fieldName = path.split('.').pop() || '';
    if (
      this.options.ignoreTimestamps &&
      this.options.timestampElements?.includes(fieldName)
    ) {
      return;
    }
    if (this.options.ignoreIds && this.options.idElements?.includes(fieldName)) {
      return;
    }

    // Type mismatch
    if (typeof obj1 !== typeof obj2) {
      differences.push({
        path,
        type: 'type_mismatch',
        expected: typeof obj1,
        actual: typeof obj2,
        description: `Type mismatch at ${path}`,
      });
      return;
    }

    // Primitives
    if (typeof obj1 !== 'object') {
      if (obj1 !== obj2) {
        differences.push({
          path,
          type: 'changed',
          expected: obj1,
          actual: obj2,
          description: `Value changed at ${path}`,
        });
      }
      return;
    }

    // Arrays
    if (Array.isArray(obj1)) {
      if (!Array.isArray(obj2)) {
        differences.push({
          path,
          type: 'type_mismatch',
          expected: 'array',
          actual: 'object',
          description: `Array/object mismatch at ${path}`,
        });
        return;
      }

      if (obj1.length !== obj2.length) {
        differences.push({
          path,
          type: 'changed',
          expected: obj1.length,
          actual: obj2.length,
          description: `Array length mismatch at ${path}`,
        });
      }

      const maxLen = Math.max(obj1.length, obj2.length);
      for (let i = 0; i < maxLen; i++) {
        this.compareObjects(obj1[i], obj2[i], `${path}[${i}]`, differences);
      }
      return;
    }

    // Objects
    const keys1 = Object.keys(obj1 as Record<string, unknown>);
    const keys2 = Object.keys(obj2 as Record<string, unknown>);
    const allKeys = new Set([...keys1, ...keys2]);

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;
      this.compareObjects(
        (obj1 as Record<string, unknown>)[key],
        (obj2 as Record<string, unknown>)[key],
        newPath,
        differences
      );
    }
  }
}
