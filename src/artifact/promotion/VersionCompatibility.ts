/**
 * Version detection and compatibility guards for cross-engine promotion.
 *
 * Checks Mirth version ranges, script syntax features (E4X, ES6, Rhino),
 * and engine type compatibility when promoting channels between environments.
 */

export interface VersionWarning {
  channelId: string;
  channelName: string;
  severity: 'block' | 'warn' | 'info';
  message: string;
}

export interface CompatibilityResult {
  compatible: boolean;
  warnings: VersionWarning[];
  blocks: VersionWarning[];
}

export interface EngineInfo {
  type: 'nodejs' | 'java';
  mirthVersion: string;
  e4xSupport: boolean;
}

export interface RhinoFeatures {
  usesE4X: boolean;
  usesES6: boolean;
  usesImportPackage: boolean;
  usesJavaAdapter: boolean;
}

export interface ChannelVersionMetadata {
  version: string;
  engineVersion?: { exportedFrom: string; exportedEngine: 'nodejs' | 'java' };
  rhinoFeatures?: RhinoFeatures;
}

/**
 * Compatibility ranges — channels within the same range are compatible.
 * Each tuple is [minVersion, maxVersion] inclusive.
 */
const COMPAT_RANGES: [string, string][] = [
  ['3.8.0', '3.8.1'],
  ['3.9.0', '3.9.1'],
  ['3.10.0', '3.10.1'],
  ['4.0.0', '4.0.1'],
  ['4.5.0', '4.5.2'],
];

export class VersionCompatibility {
  /**
   * Full compatibility check combining version, script syntax, and engine type.
   */
  static check(
    channelMetadata: ChannelVersionMetadata,
    targetEngine: EngineInfo,
    channelId = '',
    channelName = ''
  ): CompatibilityResult {
    const allWarnings: VersionWarning[] = [];
    const allBlocks: VersionWarning[] = [];
    let compatible = true;

    // 1. Mirth version compatibility
    const versionResult = VersionCompatibility.checkMirthVersion(
      channelMetadata.version,
      targetEngine.mirthVersion,
      channelId,
      channelName
    );
    allWarnings.push(...versionResult.warnings);
    allBlocks.push(...versionResult.blocks);
    if (!versionResult.compatible) compatible = false;

    // 2. Script syntax compatibility
    if (channelMetadata.rhinoFeatures) {
      const scriptResult = VersionCompatibility.checkScriptSyntax(
        channelMetadata.rhinoFeatures,
        targetEngine,
        channelId,
        channelName
      );
      allWarnings.push(...scriptResult.warnings);
      allBlocks.push(...scriptResult.blocks);
      if (!scriptResult.compatible) compatible = false;
    }

    // 3. Engine type compatibility
    if (channelMetadata.engineVersion) {
      const engineResult = VersionCompatibility.checkEngineType(
        channelMetadata.engineVersion.exportedEngine,
        targetEngine.type,
        channelId,
        channelName
      );
      allWarnings.push(...engineResult.warnings);
      allBlocks.push(...engineResult.blocks);
      if (!engineResult.compatible) compatible = false;
    }

    return { compatible, warnings: allWarnings, blocks: allBlocks };
  }

  /**
   * Check Mirth version compatibility.
   * Same range = compatible, cross-range = warning.
   */
  static checkMirthVersion(
    channelVersion: string,
    targetVersion: string,
    channelId = '',
    channelName = ''
  ): CompatibilityResult {
    const sourceRange = VersionCompatibility.findCompatRange(channelVersion);
    const targetRange = VersionCompatibility.findCompatRange(targetVersion);

    // Both in same range — fully compatible
    if (sourceRange && targetRange &&
        sourceRange[0] === targetRange[0] && sourceRange[1] === targetRange[1]) {
      return { compatible: true, warnings: [], blocks: [] };
    }

    // Both have known ranges but different — warn
    if (sourceRange && targetRange) {
      const warning: VersionWarning = {
        channelId,
        channelName,
        severity: 'warn',
        message: `Channel version ${channelVersion} (range ${sourceRange[0]}-${sourceRange[1]}) differs from target ${targetVersion} (range ${targetRange[0]}-${targetRange[1]}). May need migration.`,
      };
      return { compatible: true, warnings: [warning], blocks: [] };
    }

    // Unknown version range — info
    if (!sourceRange || !targetRange) {
      const warning: VersionWarning = {
        channelId,
        channelName,
        severity: 'info',
        message: `Version ${!sourceRange ? channelVersion : targetVersion} is not in a known compatibility range.`,
      };
      return { compatible: true, warnings: [warning], blocks: [] };
    }

    return { compatible: true, warnings: [], blocks: [] };
  }

  /**
   * Check script syntax compatibility (E4X, ES6, Rhino-specific).
   */
  static checkScriptSyntax(
    rhinoFeatures: RhinoFeatures,
    targetEngine: EngineInfo,
    channelId = '',
    channelName = ''
  ): CompatibilityResult {
    const warnings: VersionWarning[] = [];
    const blocks: VersionWarning[] = [];
    let compatible = true;

    // E4X scripts -> Java Mirth 4.0+: BLOCK (E4X dropped in Java 4.0)
    if (rhinoFeatures.usesE4X && targetEngine.type === 'java') {
      const targetMajor = VersionCompatibility.parseMajor(targetEngine.mirthVersion);
      if (targetMajor >= 4) {
        blocks.push({
          channelId,
          channelName,
          severity: 'block',
          message: 'Channel uses E4X syntax which is not supported in Java Mirth 4.0+.',
        });
        compatible = false;
      }
    }

    // ES6 scripts -> Java Mirth 3.8.x: WARN (limited Rhino ES5)
    if (rhinoFeatures.usesES6 && targetEngine.type === 'java') {
      const targetRange = VersionCompatibility.findCompatRange(targetEngine.mirthVersion);
      if (targetRange && targetRange[0] === '3.8.0') {
        warnings.push({
          channelId,
          channelName,
          severity: 'warn',
          message: 'Channel uses ES6 syntax. Java Mirth 3.8.x has limited ES5-only Rhino runtime.',
        });
      }
    }

    // importPackage() -> Node.js: WARN (transpiler handles it but worth noting)
    if (rhinoFeatures.usesImportPackage && targetEngine.type === 'nodejs') {
      warnings.push({
        channelId,
        channelName,
        severity: 'warn',
        message: 'Channel uses importPackage() which is Rhino-specific. The E4X transpiler handles this, but verify behavior.',
      });
    }

    // JavaAdapter -> Node.js: WARN
    if (rhinoFeatures.usesJavaAdapter && targetEngine.type === 'nodejs') {
      warnings.push({
        channelId,
        channelName,
        severity: 'warn',
        message: 'Channel uses JavaAdapter which is Rhino-specific. Verify compatibility with Node.js runtime.',
      });
    }

    return { compatible, warnings, blocks };
  }

  /**
   * Check engine type compatibility (Node.js <-> Java).
   */
  static checkEngineType(
    sourceEngine: 'nodejs' | 'java',
    targetEngine: 'nodejs' | 'java',
    channelId = '',
    channelName = ''
  ): CompatibilityResult {
    // Node.js -> Node.js: always allow
    if (sourceEngine === 'nodejs' && targetEngine === 'nodejs') {
      return { compatible: true, warnings: [], blocks: [] };
    }

    // Java -> Node.js: always allow (transpiler handles Rhino-isms)
    if (sourceEngine === 'java' && targetEngine === 'nodejs') {
      return { compatible: true, warnings: [], blocks: [] };
    }

    // Node.js -> Java: info (might have Node.js-only features)
    if (sourceEngine === 'nodejs' && targetEngine === 'java') {
      const warning: VersionWarning = {
        channelId,
        channelName,
        severity: 'info',
        message: 'Channel was exported from Node.js Mirth. Verify it does not use Node.js-only features.',
      };
      return { compatible: true, warnings: [warning], blocks: [] };
    }

    // Java -> Java: always allow
    return { compatible: true, warnings: [], blocks: [] };
  }

  /**
   * Find which compatibility range a version belongs to.
   */
  static findCompatRange(version: string): [string, string] | null {
    for (const range of COMPAT_RANGES) {
      const cmpMin = VersionCompatibility.compareSemver(version, range[0]);
      const cmpMax = VersionCompatibility.compareSemver(version, range[1]);
      if (cmpMin >= 0 && cmpMax <= 0) {
        return range;
      }
    }
    return null;
  }

  /**
   * Compare two semver versions. Returns -1, 0, or 1.
   */
  static compareSemver(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);
    const len = Math.max(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
      const va = partsA[i] ?? 0;
      const vb = partsB[i] ?? 0;
      if (va < vb) return -1;
      if (va > vb) return 1;
    }
    return 0;
  }

  /**
   * Parse the major version number from a semver string.
   */
  private static parseMajor(version: string): number {
    const parts = version.split('.');
    return parseInt(parts[0] ?? '0', 10);
  }
}
