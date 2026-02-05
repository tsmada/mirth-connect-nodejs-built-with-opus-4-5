/**
 * Version utilities for parsing and comparing Mirth Connect versions.
 *
 * Mirth Connect uses semantic versioning: MAJOR.MINOR.PATCH
 * Examples: 3.9.1, 3.10.0, 4.0.0, 4.5.2
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

/**
 * Parse a version string into components.
 * @param version - Version string (e.g., "3.9.1")
 * @returns Parsed version object
 * @throws Error if version format is invalid
 */
export function parseVersion(version: string): ParsedVersion {
  const cleaned = version.replace(/^v/, '').trim();
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`Invalid version format: "${version}". Expected format: MAJOR.MINOR.PATCH (e.g., 3.9.1)`);
  }

  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    raw: cleaned,
  };
}

/**
 * Compare two versions.
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string | ParsedVersion, b: string | ParsedVersion): -1 | 0 | 1 {
  const va = typeof a === 'string' ? parseVersion(a) : a;
  const vb = typeof b === 'string' ? parseVersion(b) : b;

  if (va.major !== vb.major) {
    return va.major < vb.major ? -1 : 1;
  }
  if (va.minor !== vb.minor) {
    return va.minor < vb.minor ? -1 : 1;
  }
  if (va.patch !== vb.patch) {
    return va.patch < vb.patch ? -1 : 1;
  }
  return 0;
}

/**
 * Check if version a is less than version b.
 */
export function isVersionLessThan(a: string | ParsedVersion, b: string | ParsedVersion): boolean {
  return compareVersions(a, b) === -1;
}

/**
 * Check if version a is greater than version b.
 */
export function isVersionGreaterThan(a: string | ParsedVersion, b: string | ParsedVersion): boolean {
  return compareVersions(a, b) === 1;
}

/**
 * Check if version a equals version b.
 */
export function isVersionEqual(a: string | ParsedVersion, b: string | ParsedVersion): boolean {
  return compareVersions(a, b) === 0;
}

/**
 * Get the version range type between two versions.
 */
export function getVersionRangeType(from: string, to: string): 'major' | 'minor' | 'patch' {
  const vFrom = parseVersion(from);
  const vTo = parseVersion(to);

  if (vFrom.major !== vTo.major) return 'major';
  if (vFrom.minor !== vTo.minor) return 'minor';
  return 'patch';
}

/**
 * Format a version for display.
 */
export function formatVersion(version: string | ParsedVersion): string {
  const v = typeof version === 'string' ? parseVersion(version) : version;
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Get the branch name for a version.
 * - Major versions: feature/X.0.x (e.g., feature/4.0.x)
 * - Minor versions: feature/X.Y.x (e.g., feature/3.10.x)
 */
export function getVersionBranch(version: string): string {
  const v = parseVersion(version);
  return `feature/${v.major}.${v.minor}.x`;
}

/**
 * Get the feature branch name for an upgrade task.
 */
export function getUpgradeBranch(version: string, taskName: string): string {
  return `upgrade/${version}-${taskName}`;
}

/**
 * List of known Mirth Connect versions with their Java tags.
 * This is used as a reference for version-specific features and migrations.
 */
export const KNOWN_VERSIONS: Record<string, {
  tag: string;
  releaseDate?: string;
  migrationClass?: string;
  notes?: string;
}> = {
  '3.9.0': {
    tag: '3.9.0',
    releaseDate: '2020-01-15',
    migrationClass: 'Migrate3_9_0',
  },
  '3.9.1': {
    tag: '3.9.1',
    releaseDate: '2020-03-10',
    notes: 'Current Node.js port target',
  },
  '3.10.0': {
    tag: '3.10.0',
    migrationClass: 'Migrate3_10_0',
  },
  '3.10.1': {
    tag: '3.10.1',
  },
  '3.11.0': {
    tag: '3.11.0',
    migrationClass: 'Migrate3_11_0',
  },
  '3.12.0': {
    tag: '3.12.0',
    migrationClass: 'Migrate3_12_0',
  },
  '4.0.0': {
    tag: '4.0.0',
    migrationClass: 'Migrate4_0_0',
    notes: 'Major version with breaking changes',
  },
  '4.0.1': {
    tag: '4.0.1',
  },
  '4.1.0': {
    tag: '4.1.0',
    migrationClass: 'Migrate4_1_0',
  },
  '4.1.1': {
    tag: '4.1.1',
  },
  '4.2.0': {
    tag: '4.2.0',
    migrationClass: 'Migrate4_2_0',
  },
  '4.3.0': {
    tag: '4.3.0',
    migrationClass: 'Migrate4_3_0',
  },
  '4.4.0': {
    tag: '4.4.0',
    migrationClass: 'Migrate4_4_0',
  },
  '4.4.1': {
    tag: '4.4.1',
  },
  '4.4.2': {
    tag: '4.4.2',
  },
  '4.5.0': {
    tag: '4.5.0',
    migrationClass: 'Migrate4_5_0',
  },
  '4.5.1': {
    tag: '4.5.1',
  },
  '4.5.2': {
    tag: '4.5.2',
    notes: 'Latest release',
  },
};

/**
 * Get the migration class name for a version (if any).
 */
export function getMigrationClass(version: string): string | undefined {
  return KNOWN_VERSIONS[version]?.migrationClass;
}

/**
 * List all versions between two versions (inclusive).
 */
export function getVersionsInRange(from: string, to: string): string[] {
  const versions = Object.keys(KNOWN_VERSIONS).sort((a, b) => compareVersions(a, b));
  return versions.filter(
    (v) => compareVersions(v, from) >= 0 && compareVersions(v, to) <= 0
  );
}

/**
 * Get the next version after the given version.
 */
export function getNextVersion(version: string): string | undefined {
  const versions = Object.keys(KNOWN_VERSIONS).sort((a, b) => compareVersions(a, b));
  const index = versions.indexOf(version);
  if (index === -1 || index === versions.length - 1) return undefined;
  return versions[index + 1];
}

/**
 * Get the previous version before the given version.
 */
export function getPreviousVersion(version: string): string | undefined {
  const versions = Object.keys(KNOWN_VERSIONS).sort((a, b) => compareVersions(a, b));
  const index = versions.indexOf(version);
  if (index <= 0) return undefined;
  return versions[index - 1];
}
