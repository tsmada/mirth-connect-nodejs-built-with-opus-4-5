/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/SmbSchemeProperties.java
 *
 * Purpose: Configuration properties specific to SMB/CIFS connections.
 *
 * Key behaviors:
 * - Configurable SMB dialect version range (min/max)
 * - Java defaults: SMB 2.0.2 (min) to SMB 3.1.1 (max)
 * - Domain-based NTLM authentication (domain\username or domain/username)
 */

/**
 * Supported SMB dialect versions matching Java's SmbDialectVersion.
 */
export const SMB_DIALECT_VERSIONS = [
  { version: 'SMB1', readable: 'SMB v1' },
  { version: 'SMB202', readable: 'SMB v2.0.2' },
  { version: 'SMB210', readable: 'SMB v2.1' },
  { version: 'SMB300', readable: 'SMB v3.0' },
  { version: 'SMB302', readable: 'SMB v3.0.2' },
  { version: 'SMB311', readable: 'SMB v3.1.1' },
] as const;

export type SmbDialectVersion = typeof SMB_DIALECT_VERSIONS[number]['version'];

/**
 * SMB scheme-specific configuration properties.
 */
export interface SmbSchemeProperties {
  /** Minimum SMB dialect version. Java default: "SMB202" */
  smbMinVersion: string;

  /** Maximum SMB dialect version. Java default: "SMB311" */
  smbMaxVersion: string;
}

/**
 * Returns default SMB scheme properties matching Java defaults.
 */
export function getDefaultSmbSchemeProperties(): SmbSchemeProperties {
  return {
    smbMinVersion: 'SMB202',
    smbMaxVersion: 'SMB311',
  };
}

/**
 * Get human-readable version string for an SMB dialect version.
 */
export function getReadableVersion(dialectVersion: string): string | null {
  const found = SMB_DIALECT_VERSIONS.find(v => v.version === dialectVersion);
  return found ? found.readable : null;
}
