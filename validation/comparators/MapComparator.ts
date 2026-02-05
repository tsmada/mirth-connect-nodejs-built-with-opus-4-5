/**
 * MapComparator - Compare channel map variables between Java and Node.js Mirth
 *
 * Validates that map variables ($c, $s, $g, $gc, $co, $r) behave identically
 * across both engines.
 */

export interface MapComparisonResult {
  identical: boolean;
  differences: MapDifference[];
  summary: string;
}

export interface MapDifference {
  mapType: string;
  key: string;
  expected: unknown;
  actual: unknown;
  type: 'missing' | 'extra' | 'value_mismatch' | 'type_mismatch';
}

export interface AllMaps {
  channelMap?: Record<string, unknown>;     // $c
  sourceMap?: Record<string, unknown>;      // $s
  globalMap?: Record<string, unknown>;      // $g
  globalChannelMap?: Record<string, unknown>; // $gc
  connectorMap?: Record<string, unknown>;   // $co
  responseMap?: Record<string, unknown>;    // $r
  configurationMap?: Record<string, unknown>; // $cfg
}

const MAP_TYPES = [
  'channelMap',
  'sourceMap',
  'globalMap',
  'globalChannelMap',
  'connectorMap',
  'responseMap',
  'configurationMap',
] as const;

type MapType = typeof MAP_TYPES[number];

export class MapComparator {
  /**
   * Compare channel maps between Java and Node.js Mirth
   *
   * @param javaMap Map from Java Mirth
   * @param nodeMap Map from Node.js Mirth
   * @param mapType Name of the map type for reporting
   * @returns Comparison result with differences
   */
  compareChannelMaps(
    javaMap: Record<string, unknown>,
    nodeMap: Record<string, unknown>,
    mapType: string = 'channelMap'
  ): MapComparisonResult {
    const differences: MapDifference[] = [];

    // Check for missing or different keys in nodeMap
    for (const key of Object.keys(javaMap)) {
      if (!(key in nodeMap)) {
        differences.push({
          mapType,
          key,
          expected: javaMap[key],
          actual: undefined,
          type: 'missing',
        });
      } else if (!this.deepEqual(javaMap[key], nodeMap[key])) {
        const javaType = typeof javaMap[key];
        const nodeType = typeof nodeMap[key];
        differences.push({
          mapType,
          key,
          expected: javaMap[key],
          actual: nodeMap[key],
          type: javaType !== nodeType ? 'type_mismatch' : 'value_mismatch',
        });
      }
    }

    // Check for extra keys in nodeMap
    for (const key of Object.keys(nodeMap)) {
      if (!(key in javaMap)) {
        differences.push({
          mapType,
          key,
          expected: undefined,
          actual: nodeMap[key],
          type: 'extra',
        });
      }
    }

    return {
      identical: differences.length === 0,
      differences,
      summary: this.generateSummary(differences, mapType),
    };
  }

  /**
   * Validate map values against expected assertions
   *
   * Useful for validating that specific values are set correctly
   * without comparing the entire map.
   *
   * @param actualMap The actual map values
   * @param assertions Expected key-value pairs
   * @param mapType Name of the map type for reporting
   */
  validateMapAssertions(
    actualMap: Record<string, unknown>,
    assertions: Record<string, unknown>,
    mapType: string = 'channelMap'
  ): MapComparisonResult {
    const differences: MapDifference[] = [];

    for (const [key, expectedValue] of Object.entries(assertions)) {
      if (!(key in actualMap)) {
        differences.push({
          mapType,
          key,
          expected: expectedValue,
          actual: undefined,
          type: 'missing',
        });
      } else {
        const actualValue = actualMap[key];
        // Handle numeric string equivalence
        if (!this.valuesEqual(expectedValue, actualValue)) {
          differences.push({
            mapType,
            key,
            expected: expectedValue,
            actual: actualValue,
            type: 'value_mismatch',
          });
        }
      }
    }

    return {
      identical: differences.length === 0,
      differences,
      summary: this.generateSummary(differences, mapType),
    };
  }

  /**
   * Compare all map types from a message context
   *
   * @param javaMaps All maps from Java Mirth
   * @param nodeMaps All maps from Node.js Mirth
   */
  compareAllMaps(javaMaps: AllMaps, nodeMaps: AllMaps): MapComparisonResult {
    const allDifferences: MapDifference[] = [];

    for (const mapType of MAP_TYPES) {
      const javaMap = javaMaps[mapType] || {};
      const nodeMap = nodeMaps[mapType] || {};
      const result = this.compareChannelMaps(javaMap, nodeMap, mapType);
      allDifferences.push(...result.differences);
    }

    return {
      identical: allDifferences.length === 0,
      differences: allDifferences,
      summary: this.generateAllMapsSummary(allDifferences),
    };
  }

  /**
   * Compare maps with options for flexible matching
   */
  compareWithOptions(
    javaMap: Record<string, unknown>,
    nodeMap: Record<string, unknown>,
    options: {
      mapType?: string;
      ignoreKeys?: string[];
      numericStringEquivalence?: boolean;
      ignoreMissing?: boolean;
      ignoreExtra?: boolean;
    } = {}
  ): MapComparisonResult {
    const {
      mapType = 'channelMap',
      ignoreKeys = [],
      numericStringEquivalence = true,
      ignoreMissing = false,
      ignoreExtra = false,
    } = options;

    const differences: MapDifference[] = [];

    // Check for missing or different keys in nodeMap
    for (const key of Object.keys(javaMap)) {
      if (ignoreKeys.includes(key)) continue;

      if (!(key in nodeMap)) {
        if (!ignoreMissing) {
          differences.push({
            mapType,
            key,
            expected: javaMap[key],
            actual: undefined,
            type: 'missing',
          });
        }
      } else {
        const javaVal = javaMap[key];
        const nodeVal = nodeMap[key];
        const areEqual = numericStringEquivalence
          ? this.valuesEqual(javaVal, nodeVal)
          : this.deepEqual(javaVal, nodeVal);

        if (!areEqual) {
          differences.push({
            mapType,
            key,
            expected: javaVal,
            actual: nodeVal,
            type: typeof javaVal !== typeof nodeVal ? 'type_mismatch' : 'value_mismatch',
          });
        }
      }
    }

    // Check for extra keys in nodeMap
    if (!ignoreExtra) {
      for (const key of Object.keys(nodeMap)) {
        if (ignoreKeys.includes(key)) continue;

        if (!(key in javaMap)) {
          differences.push({
            mapType,
            key,
            expected: undefined,
            actual: nodeMap[key],
            type: 'extra',
          });
        }
      }
    }

    return {
      identical: differences.length === 0,
      differences,
      summary: this.generateSummary(differences, mapType),
    };
  }

  /**
   * Deep equality check for complex values
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object') return a === b;

    // Array comparison
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => this.deepEqual(val, b[i]));
    }

    // Check for array vs non-array mismatch
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    // Object comparison
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => this.deepEqual(aObj[key], bObj[key]));
  }

  /**
   * Value equality with numeric string equivalence
   *
   * Treats "123" as equal to 123 for more flexible comparison
   */
  private valuesEqual(expected: unknown, actual: unknown): boolean {
    // Direct equality
    if (expected === actual) return true;

    // Numeric string equivalence: "123" == 123
    if (typeof expected === 'string' && typeof actual === 'number') {
      const parsed = parseFloat(expected);
      return !isNaN(parsed) && parsed === actual;
    }
    if (typeof expected === 'number' && typeof actual === 'string') {
      const parsed = parseFloat(actual);
      return !isNaN(parsed) && parsed === expected;
    }

    // Boolean string equivalence: "true" == true
    if (typeof expected === 'string' && typeof actual === 'boolean') {
      return expected.toLowerCase() === String(actual);
    }
    if (typeof expected === 'boolean' && typeof actual === 'string') {
      return String(expected) === actual.toLowerCase();
    }

    // Deep equality for objects
    return this.deepEqual(expected, actual);
  }

  /**
   * Generate a summary of differences
   */
  private generateSummary(differences: MapDifference[], mapType: string): string {
    if (differences.length === 0) {
      return `${mapType} matches`;
    }

    const counts = {
      missing: 0,
      extra: 0,
      value_mismatch: 0,
      type_mismatch: 0,
    };

    for (const diff of differences) {
      counts[diff.type]++;
    }

    const parts: string[] = [];
    if (counts.missing > 0) parts.push(`${counts.missing} missing`);
    if (counts.extra > 0) parts.push(`${counts.extra} extra`);
    if (counts.value_mismatch > 0) parts.push(`${counts.value_mismatch} value mismatches`);
    if (counts.type_mismatch > 0) parts.push(`${counts.type_mismatch} type mismatches`);

    return `${mapType}: ${differences.length} differences (${parts.join(', ')})`;
  }

  /**
   * Generate summary for all maps comparison
   */
  private generateAllMapsSummary(differences: MapDifference[]): string {
    if (differences.length === 0) {
      return 'All maps match';
    }

    const byMapType: Record<string, number> = {};
    for (const diff of differences) {
      byMapType[diff.mapType] = (byMapType[diff.mapType] || 0) + 1;
    }

    const parts = Object.entries(byMapType)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');

    return `${differences.length} total differences (${parts})`;
  }
}
