import { XMLParser } from 'fast-xml-parser';
import * as diff from 'diff';

export interface ComparisonResult {
  match: boolean;
  differences: Difference[];
  summary: string;
}

export interface Difference {
  path: string;
  type: 'added' | 'removed' | 'changed' | 'type_mismatch';
  expected?: unknown;
  actual?: unknown;
  description: string;
}

export interface ComparisonOptions {
  ignoreFields?: string[];
  ignoreWhitespace?: boolean;
  ignoreAttributeOrder?: boolean;
  normalizeLineEndings?: boolean;
  timestampFields?: string[];
  idFields?: string[];
}

const DEFAULT_OPTIONS: ComparisonOptions = {
  ignoreFields: [],
  ignoreWhitespace: true,
  ignoreAttributeOrder: true,
  normalizeLineEndings: true,
  timestampFields: ['MSH.7', 'MSH-7', 'dateTime', 'timestamp', 'lastModified'],
  idFields: ['MSH.10', 'MSH-10', 'messageControlId', 'id'],
};

export class MessageComparator {
  private options: ComparisonOptions;
  private xmlParser: XMLParser;

  constructor(options: ComparisonOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: false,
      trimValues: this.options.ignoreWhitespace ?? true,
    });
  }

  /**
   * Compare two HL7v2 messages
   */
  compareHL7(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    // Normalize line endings
    const norm1 = this.normalizeHL7(expected);
    const norm2 = this.normalizeHL7(actual);

    const segments1 = norm1.split(/[\r\n]+/).filter((s) => s.length > 0);
    const segments2 = norm2.split(/[\r\n]+/).filter((s) => s.length > 0);

    // Compare segment counts
    if (segments1.length !== segments2.length) {
      differences.push({
        path: 'segments',
        type: 'changed',
        expected: segments1.length,
        actual: segments2.length,
        description: `Different number of segments: expected ${segments1.length}, got ${segments2.length}`,
      });
    }

    // Compare each segment
    const maxSegments = Math.max(segments1.length, segments2.length);
    for (let i = 0; i < maxSegments; i++) {
      const seg1 = segments1[i];
      const seg2 = segments2[i];

      if (seg1 === undefined) {
        differences.push({
          path: `segment[${i}]`,
          type: 'added',
          actual: seg2,
          description: `Extra segment: ${seg2?.substring(0, 50)}...`,
        });
      } else if (seg2 === undefined) {
        differences.push({
          path: `segment[${i}]`,
          type: 'removed',
          expected: seg1,
          description: `Missing segment: ${seg1.substring(0, 50)}...`,
        });
      } else {
        const segmentDiffs = this.compareHL7Segment(seg1, seg2, i);
        differences.push(...segmentDiffs);
      }
    }

    return {
      match: differences.length === 0,
      differences,
      summary: this.generateSummary(differences),
    };
  }

  /**
   * Compare two HL7 segments field by field
   */
  private compareHL7Segment(seg1: string, seg2: string, segmentIndex: number): Difference[] {
    const differences: Difference[] = [];
    const segmentType = seg1.substring(0, 3);

    // Handle MSH specially (field separator is field 1)
    const delimiter = segmentType === 'MSH' ? seg1[3] : '|';
    const fields1 = seg1.split(delimiter);
    const fields2 = seg2.split(delimiter);

    // Compare segment type
    if (fields1[0] !== fields2[0]) {
      differences.push({
        path: `segment[${segmentIndex}].type`,
        type: 'changed',
        expected: fields1[0],
        actual: fields2[0],
        description: `Segment type mismatch: expected ${fields1[0]}, got ${fields2[0]}`,
      });
      return differences;
    }

    // Compare fields
    const maxFields = Math.max(fields1.length, fields2.length);
    for (let f = 1; f < maxFields; f++) {
      const fieldPath = `${segmentType}.${f}`;

      // Skip ignored fields
      if (this.shouldIgnoreField(fieldPath)) {
        continue;
      }

      const field1 = fields1[f] || '';
      const field2 = fields2[f] || '';

      if (field1 !== field2) {
        differences.push({
          path: `segment[${segmentIndex}].${fieldPath}`,
          type: 'changed',
          expected: field1,
          actual: field2,
          description: `Field ${fieldPath} differs: expected "${field1}", got "${field2}"`,
        });
      }
    }

    return differences;
  }

  /**
   * Compare two XML documents
   */
  compareXML(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    try {
      const norm1 = this.normalizeXML(expected);
      const norm2 = this.normalizeXML(actual);

      const obj1 = this.xmlParser.parse(norm1);
      const obj2 = this.xmlParser.parse(norm2);

      this.compareObjects(obj1, obj2, '', differences);
    } catch (error) {
      differences.push({
        path: 'parse',
        type: 'type_mismatch',
        description: `XML parse error: ${(error as Error).message}`,
      });
    }

    return {
      match: differences.length === 0,
      differences,
      summary: this.generateSummary(differences),
    };
  }

  /**
   * Compare two JSON documents
   */
  compareJSON(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    try {
      const obj1 = JSON.parse(expected);
      const obj2 = JSON.parse(actual);

      this.compareObjects(obj1, obj2, '', differences);
    } catch (error) {
      differences.push({
        path: 'parse',
        type: 'type_mismatch',
        description: `JSON parse error: ${(error as Error).message}`,
      });
    }

    return {
      match: differences.length === 0,
      differences,
      summary: this.generateSummary(differences),
    };
  }

  /**
   * Compare two plain text documents
   */
  compareText(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    const norm1 = this.options.normalizeLineEndings
      ? expected.replace(/\r\n/g, '\n')
      : expected;
    const norm2 = this.options.normalizeLineEndings
      ? actual.replace(/\r\n/g, '\n')
      : actual;

    if (norm1 !== norm2) {
      const textDiff = diff.diffLines(norm1, norm2);
      let lineNum = 1;

      for (const part of textDiff) {
        if (part.added) {
          differences.push({
            path: `line:${lineNum}`,
            type: 'added',
            actual: part.value.trim(),
            description: `Added: ${part.value.substring(0, 100)}`,
          });
        } else if (part.removed) {
          differences.push({
            path: `line:${lineNum}`,
            type: 'removed',
            expected: part.value.trim(),
            description: `Removed: ${part.value.substring(0, 100)}`,
          });
        }
        lineNum += (part.value.match(/\n/g) || []).length;
      }
    }

    return {
      match: differences.length === 0,
      differences,
      summary: this.generateSummary(differences),
    };
  }

  /**
   * Auto-detect message type and compare
   */
  compare(expected: string, actual: string): ComparisonResult {
    const trimmed = expected.trim();

    // Detect HL7v2 (starts with MSH|)
    if (trimmed.startsWith('MSH|') || trimmed.startsWith('MSH^')) {
      return this.compareHL7(expected, actual);
    }

    // Detect XML (starts with < or <?xml)
    if (trimmed.startsWith('<')) {
      return this.compareXML(expected, actual);
    }

    // Detect JSON (starts with { or [)
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return this.compareJSON(expected, actual);
    }

    // Default to text comparison
    return this.compareText(expected, actual);
  }

  /**
   * Compare two objects recursively
   */
  private compareObjects(
    obj1: unknown,
    obj2: unknown,
    path: string,
    differences: Difference[]
  ): void {
    // Skip ignored fields
    if (this.shouldIgnoreField(path)) {
      return;
    }

    // Type check
    const type1 = typeof obj1;
    const type2 = typeof obj2;

    if (type1 !== type2) {
      differences.push({
        path: path || 'root',
        type: 'type_mismatch',
        expected: `${type1} (${String(obj1)})`,
        actual: `${type2} (${String(obj2)})`,
        description: `Type mismatch at ${path || 'root'}: expected ${type1}, got ${type2}`,
      });
      return;
    }

    // Null check
    if (obj1 === null || obj2 === null) {
      if (obj1 !== obj2) {
        differences.push({
          path: path || 'root',
          type: 'changed',
          expected: obj1,
          actual: obj2,
          description: `Value mismatch at ${path || 'root'}: expected ${obj1}, got ${obj2}`,
        });
      }
      return;
    }

    // Array comparison
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      if (obj1.length !== obj2.length) {
        differences.push({
          path: `${path}.length`,
          type: 'changed',
          expected: obj1.length,
          actual: obj2.length,
          description: `Array length mismatch at ${path}: expected ${obj1.length}, got ${obj2.length}`,
        });
      }

      const maxLen = Math.max(obj1.length, obj2.length);
      for (let i = 0; i < maxLen; i++) {
        this.compareObjects(obj1[i], obj2[i], `${path}[${i}]`, differences);
      }
      return;
    }

    // Object comparison
    if (type1 === 'object') {
      const record1 = obj1 as Record<string, unknown>;
      const record2 = obj2 as Record<string, unknown>;
      const keys1 = Object.keys(record1);
      const keys2 = Object.keys(record2);
      const allKeys = new Set([...keys1, ...keys2]);

      for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key;

        if (!(key in record1)) {
          differences.push({
            path: newPath,
            type: 'added',
            actual: record2[key],
            description: `Extra property at ${newPath}`,
          });
        } else if (!(key in record2)) {
          differences.push({
            path: newPath,
            type: 'removed',
            expected: record1[key],
            description: `Missing property at ${newPath}`,
          });
        } else {
          this.compareObjects(record1[key], record2[key], newPath, differences);
        }
      }
      return;
    }

    // Primitive comparison
    if (obj1 !== obj2) {
      differences.push({
        path: path || 'root',
        type: 'changed',
        expected: obj1,
        actual: obj2,
        description: `Value mismatch at ${path || 'root'}: expected "${obj1}", got "${obj2}"`,
      });
    }
  }

  /**
   * Check if a field should be ignored
   */
  private shouldIgnoreField(path: string): boolean {
    const allIgnored = [
      ...(this.options.ignoreFields || []),
      ...(this.options.timestampFields || []),
      ...(this.options.idFields || []),
    ];

    for (const ignored of allIgnored) {
      if (path.includes(ignored)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Normalize HL7 message for comparison
   */
  private normalizeHL7(message: string): string {
    let normalized = message;

    if (this.options.normalizeLineEndings) {
      normalized = normalized.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    }

    if (this.options.ignoreWhitespace) {
      // Don't trim segment content, but remove leading/trailing whitespace
      normalized = normalized.trim();
    }

    return normalized;
  }

  /**
   * Normalize XML for comparison
   */
  private normalizeXML(xml: string): string {
    let normalized = xml;

    if (this.options.normalizeLineEndings) {
      normalized = normalized.replace(/\r\n/g, '\n');
    }

    if (this.options.ignoreWhitespace) {
      // Remove whitespace between tags
      normalized = normalized.replace(/>\s+</g, '><');
      normalized = normalized.trim();
    }

    return normalized;
  }

  /**
   * Generate a summary of differences
   */
  private generateSummary(differences: Difference[]): string {
    if (differences.length === 0) {
      return 'Messages match';
    }

    const counts = {
      added: 0,
      removed: 0,
      changed: 0,
      type_mismatch: 0,
    };

    for (const diff of differences) {
      counts[diff.type]++;
    }

    const parts: string[] = [];
    if (counts.added > 0) parts.push(`${counts.added} added`);
    if (counts.removed > 0) parts.push(`${counts.removed} removed`);
    if (counts.changed > 0) parts.push(`${counts.changed} changed`);
    if (counts.type_mismatch > 0) parts.push(`${counts.type_mismatch} type mismatches`);

    return `${differences.length} differences: ${parts.join(', ')}`;
  }
}
