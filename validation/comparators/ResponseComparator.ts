import { ComparisonResult, Difference } from './MessageComparator';

export interface AckInfo {
  ackCode: string;
  messageControlId?: string;
  textMessage?: string;
  errorCondition?: string;
  segments: string[];
}

export interface AckComparisonResult extends ComparisonResult {
  expectedAck: AckInfo;
  actualAck: AckInfo;
  ackCodeMatch: boolean;
}

export interface HttpResponseComparisonResult extends ComparisonResult {
  statusCodeMatch: boolean;
  expectedStatusCode: number;
  actualStatusCode: number;
  headerDifferences: Difference[];
  bodyDifferences: Difference[];
}

export class ResponseComparator {
  /**
   * Parse an HL7 ACK message
   */
  parseAck(ackMessage: string): AckInfo {
    const segments = ackMessage
      .split(/[\r\n]+/)
      .filter((s) => s.length > 0);

    const result: AckInfo = {
      ackCode: 'UNKNOWN',
      segments,
    };

    // Find MSA segment
    const msaSegment = segments.find((s) => s.startsWith('MSA'));
    if (msaSegment) {
      const fields = msaSegment.split('|');
      result.ackCode = fields[1] || 'UNKNOWN';
      result.messageControlId = fields[2];
      result.textMessage = fields[3];
    }

    // Find ERR segment for error details
    const errSegment = segments.find((s) => s.startsWith('ERR'));
    if (errSegment) {
      const fields = errSegment.split('|');
      result.errorCondition = fields[1];
    }

    return result;
  }

  /**
   * Compare two HL7 ACK messages
   */
  compareAck(expected: string, actual: string): AckComparisonResult {
    const expectedAck = this.parseAck(expected);
    const actualAck = this.parseAck(actual);
    const differences: Difference[] = [];

    // Compare ACK codes
    const ackCodeMatch = expectedAck.ackCode === actualAck.ackCode;
    if (!ackCodeMatch) {
      differences.push({
        path: 'MSA.1',
        type: 'changed',
        expected: expectedAck.ackCode,
        actual: actualAck.ackCode,
        description: `ACK code mismatch: expected ${expectedAck.ackCode}, got ${actualAck.ackCode}`,
      });
    }

    // Compare error messages (if both are errors)
    if (
      this.isErrorAck(expectedAck.ackCode) &&
      this.isErrorAck(actualAck.ackCode)
    ) {
      // Text messages don't need to be identical, but both should have one if error
      if (expectedAck.textMessage && !actualAck.textMessage) {
        differences.push({
          path: 'MSA.3',
          type: 'removed',
          expected: expectedAck.textMessage,
          description: 'Missing error text message in actual ACK',
        });
      }
    }

    // Compare segment counts
    if (expectedAck.segments.length !== actualAck.segments.length) {
      differences.push({
        path: 'segments.length',
        type: 'changed',
        expected: expectedAck.segments.length,
        actual: actualAck.segments.length,
        description: `Segment count mismatch: expected ${expectedAck.segments.length}, got ${actualAck.segments.length}`,
      });
    }

    // Compare segment types (not content, just presence)
    const expectedTypes = expectedAck.segments.map((s) => s.substring(0, 3));
    const actualTypes = actualAck.segments.map((s) => s.substring(0, 3));

    for (let i = 0; i < Math.max(expectedTypes.length, actualTypes.length); i++) {
      if (expectedTypes[i] !== actualTypes[i]) {
        differences.push({
          path: `segment[${i}].type`,
          type: 'changed',
          expected: expectedTypes[i],
          actual: actualTypes[i],
          description: `Segment type mismatch at index ${i}: expected ${expectedTypes[i]}, got ${actualTypes[i]}`,
        });
      }
    }

    return {
      match: differences.length === 0,
      differences,
      summary: this.generateSummary(differences, ackCodeMatch),
      expectedAck,
      actualAck,
      ackCodeMatch,
    };
  }

  /**
   * Compare HTTP responses
   */
  compareHttpResponse(
    expectedStatusCode: number,
    expectedBody: string,
    actualStatusCode: number,
    actualBody: string,
    expectedHeaders?: Record<string, string>,
    actualHeaders?: Record<string, string>
  ): HttpResponseComparisonResult {
    const differences: Difference[] = [];
    const headerDifferences: Difference[] = [];
    const bodyDifferences: Difference[] = [];

    // Compare status codes
    const statusCodeMatch = expectedStatusCode === actualStatusCode;
    if (!statusCodeMatch) {
      differences.push({
        path: 'statusCode',
        type: 'changed',
        expected: expectedStatusCode,
        actual: actualStatusCode,
        description: `Status code mismatch: expected ${expectedStatusCode}, got ${actualStatusCode}`,
      });
    }

    // Compare headers (if provided)
    if (expectedHeaders && actualHeaders) {
      for (const [key, expectedValue] of Object.entries(expectedHeaders)) {
        const actualValue = actualHeaders[key.toLowerCase()] || actualHeaders[key];
        if (actualValue !== expectedValue) {
          const diff: Difference = {
            path: `headers.${key}`,
            type: actualValue ? 'changed' : 'removed',
            expected: expectedValue,
            actual: actualValue,
            description: `Header ${key} mismatch: expected "${expectedValue}", got "${actualValue}"`,
          };
          differences.push(diff);
          headerDifferences.push(diff);
        }
      }
    }

    // Compare body
    if (expectedBody !== actualBody) {
      const bodyDiff: Difference = {
        path: 'body',
        type: 'changed',
        expected: expectedBody.substring(0, 500),
        actual: actualBody.substring(0, 500),
        description: `Body content mismatch (showing first 500 chars)`,
      };
      differences.push(bodyDiff);
      bodyDifferences.push(bodyDiff);
    }

    return {
      match: differences.length === 0,
      differences,
      summary: `Status: ${statusCodeMatch ? 'match' : 'mismatch'}, ` +
        `Headers: ${headerDifferences.length} diffs, ` +
        `Body: ${bodyDifferences.length} diffs`,
      statusCodeMatch,
      expectedStatusCode,
      actualStatusCode,
      headerDifferences,
      bodyDifferences,
    };
  }

  /**
   * Check if an ACK code indicates an error
   */
  private isErrorAck(ackCode: string): boolean {
    return ackCode === 'AE' || ackCode === 'AR' || ackCode === 'CE' || ackCode === 'CR';
  }

  /**
   * Generate comparison summary
   */
  private generateSummary(differences: Difference[], ackCodeMatch: boolean): string {
    if (differences.length === 0) {
      return 'ACK responses match';
    }

    const parts: string[] = [];
    if (!ackCodeMatch) {
      parts.push('ACK codes differ');
    }

    const segmentDiffs = differences.filter((d) => d.path.includes('segment'));
    if (segmentDiffs.length > 0) {
      parts.push(`${segmentDiffs.length} segment differences`);
    }

    return `${differences.length} differences: ${parts.join(', ')}`;
  }
}
