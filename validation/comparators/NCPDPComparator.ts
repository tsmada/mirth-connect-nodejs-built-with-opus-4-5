import { ComparisonResult, Difference } from './MessageComparator';

export interface NCPDPComparisonOptions {
  ignoreTimestamps?: boolean;
  ignoreTransactionIds?: boolean;
  format?: 'D.0' | '5.1' | 'auto';
}

const DEFAULT_OPTIONS: NCPDPComparisonOptions = {
  ignoreTimestamps: true,
  ignoreTransactionIds: true,
  format: 'auto',
};

interface NCPDPSegment {
  id: string;
  fields: Map<string, string>;
}

/**
 * Comparator for NCPDP pharmacy claims.
 * Supports both D.0 flat format and 5.1 XML format.
 */
export class NCPDPComparator {
  private options: NCPDPComparisonOptions;

  constructor(options: NCPDPComparisonOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Compare two NCPDP messages
   */
  compare(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    try {
      const format = this.detectFormat(expected);

      if (format === '5.1') {
        return this.compare51(expected, actual);
      } else {
        return this.compareD0(expected, actual);
      }
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
        summary: 'Failed to parse NCPDP messages',
      };
    }
  }

  /**
   * Detect NCPDP format (D.0 or 5.1)
   */
  private detectFormat(message: string): 'D.0' | '5.1' {
    const trimmed = message.trim();
    if (trimmed.startsWith('<') || trimmed.includes('xmlns="http://www.ncpdp.org')) {
      return '5.1';
    }
    return 'D.0';
  }

  /**
   * Compare D.0 flat format messages
   */
  private compareD0(expected: string, actual: string): ComparisonResult {
    const differences: Difference[] = [];

    const seg1 = this.parseD0(expected);
    const seg2 = this.parseD0(actual);

    // Compare segment counts
    if (seg1.length !== seg2.length) {
      differences.push({
        path: 'segments',
        type: 'changed',
        expected: seg1.length,
        actual: seg2.length,
        description: `Different number of segments: expected ${seg1.length}, got ${seg2.length}`,
      });
    }

    // Compare each segment
    const maxSegs = Math.max(seg1.length, seg2.length);
    for (let i = 0; i < maxSegs; i++) {
      const s1 = seg1[i];
      const s2 = seg2[i];

      if (!s1) {
        differences.push({
          path: `segment[${i}]`,
          type: 'added',
          actual: s2?.id,
          description: `Extra segment at position ${i}: ${s2?.id}`,
        });
        continue;
      }

      if (!s2) {
        differences.push({
          path: `segment[${i}]`,
          type: 'removed',
          expected: s1.id,
          description: `Missing segment at position ${i}: ${s1.id}`,
        });
        continue;
      }

      if (s1.id !== s2.id) {
        differences.push({
          path: `segment[${i}].id`,
          type: 'changed',
          expected: s1.id,
          actual: s2.id,
          description: `Segment ID mismatch at position ${i}`,
        });
      }

      // Compare fields
      this.compareFields(s1.fields, s2.fields, `segment[${i}]`, differences);
    }

    const match = differences.length === 0;
    return {
      match,
      differences,
      summary: match
        ? 'NCPDP D.0 messages match'
        : `Found ${differences.length} difference(s)`,
    };
  }

  /**
   * Parse D.0 format into segments
   */
  private parseD0(message: string): NCPDPSegment[] {
    const segments: NCPDPSegment[] = [];
    const trimmed = message.trim();

    // D.0 uses segment identifiers like AM01, AM04, AM07
    // Fields are prefixed with 2-char field IDs
    const segmentRegex = /(AM\d{2})/g;
    const parts = trimmed.split(segmentRegex).filter(Boolean);

    for (let i = 0; i < parts.length; i += 2) {
      const segId = parts[i];
      const segData = parts[i + 1] || '';

      const fields = this.parseD0Fields(segData);
      segments.push({ id: segId, fields });
    }

    return segments;
  }

  /**
   * Parse D.0 field data
   */
  private parseD0Fields(data: string): Map<string, string> {
    const fields = new Map<string, string>();

    // Fields are prefixed with 2-char identifiers
    // e.g., C21234567892CY01 -> C2=1234567892, CY=01
    let pos = 0;
    while (pos < data.length - 1) {
      const fieldId = data.substring(pos, pos + 2);
      pos += 2;

      // Find next field (2 uppercase chars)
      let nextField = data.substring(pos).search(/[A-Z]{2}/);
      if (nextField === -1) {
        nextField = data.length - pos;
      }

      const value = data.substring(pos, pos + nextField);
      fields.set(fieldId, value);
      pos += nextField;
    }

    return fields;
  }

  /**
   * Compare 5.1 XML format messages
   */
  private compare51(expected: string, actual: string): ComparisonResult {
    // For 5.1, we use simple XML comparison
    // A more sophisticated approach would parse the XML properly
    const norm1 = this.normalize51(expected);
    const norm2 = this.normalize51(actual);

    if (norm1 === norm2) {
      return {
        match: true,
        differences: [],
        summary: 'NCPDP 5.1 messages match',
      };
    }

    return {
      match: false,
      differences: [
        {
          path: 'content',
          type: 'changed',
          description: 'NCPDP 5.1 message content differs',
        },
      ],
      summary: 'NCPDP 5.1 messages differ',
    };
  }

  /**
   * Normalize 5.1 XML for comparison
   */
  private normalize51(xml: string): string {
    let normalized = xml
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();

    // Remove timestamps if configured
    if (this.options.ignoreTimestamps) {
      normalized = normalized.replace(
        /<SentTime>[^<]*<\/SentTime>/g,
        '<SentTime>IGNORED</SentTime>'
      );
    }

    // Remove transaction IDs if configured
    if (this.options.ignoreTransactionIds) {
      normalized = normalized.replace(
        /<MessageID>[^<]*<\/MessageID>/g,
        '<MessageID>IGNORED</MessageID>'
      );
    }

    return normalized;
  }

  /**
   * Compare field maps
   */
  private compareFields(
    fields1: Map<string, string>,
    fields2: Map<string, string>,
    basePath: string,
    differences: Difference[]
  ): void {
    const allKeys = new Set([...fields1.keys(), ...fields2.keys()]);

    // Skip timestamp/ID fields if configured
    const skipFields = new Set<string>();
    if (this.options.ignoreTimestamps) {
      skipFields.add('D2'); // Date of service
      skipFields.add('D7'); // Date written
    }
    if (this.options.ignoreTransactionIds) {
      skipFields.add('D3'); // Transaction count
    }

    for (const key of allKeys) {
      if (skipFields.has(key)) continue;

      const val1 = fields1.get(key);
      const val2 = fields2.get(key);

      if (val1 !== val2) {
        differences.push({
          path: `${basePath}.${key}`,
          type: val1 === undefined ? 'added' : val2 === undefined ? 'removed' : 'changed',
          expected: val1,
          actual: val2,
          description: `Field ${key} differs`,
        });
      }
    }
  }
}
