/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/SftpSchemeProperties.java
 *
 * Purpose: Configuration properties for SFTP connections
 *
 * Key behaviors to replicate:
 * - Support password and public key authentication
 * - Host key verification settings
 * - Known hosts file support
 * - Custom SSH configuration settings
 */

/**
 * Host key checking modes
 * - 'yes': Strictly verify host key against known_hosts (recommended for production)
 * - 'no': Disable host key checking (insecure, useful for testing)
 * - 'ask': Prompt for new host keys (not applicable in Node.js context, treated as 'yes')
 */
export type HostKeyChecking = 'yes' | 'no' | 'ask';

/**
 * SFTP scheme-specific configuration properties
 */
export interface SftpSchemeProperties {
  /** Enable password authentication */
  passwordAuth: boolean;

  /** Enable public key authentication */
  keyAuth: boolean;

  /** Path to private key file (for key-based auth) */
  keyFile: string;

  /** Passphrase for encrypted private key */
  passPhrase: string;

  /** Host key checking mode */
  hostKeyChecking: HostKeyChecking;

  /** Path to known_hosts file for host key verification */
  knownHostsFile: string;

  /**
   * Additional SSH configuration settings
   * Maps to JSch session config in Java implementation
   * Example: { 'PreferredAuthentications': 'publickey,password' }
   */
  configurationSettings: Record<string, string>;
}

/**
 * Returns default SFTP scheme properties matching Java defaults
 */
export function getDefaultSftpSchemeProperties(): SftpSchemeProperties {
  return {
    passwordAuth: true,
    keyAuth: false,
    keyFile: '',
    passPhrase: '',
    hostKeyChecking: 'ask',
    knownHostsFile: '',
    configurationSettings: {},
  };
}

/**
 * Validates SFTP scheme properties
 * @throws Error if properties are invalid
 */
export function validateSftpSchemeProperties(props: SftpSchemeProperties): void {
  // At least one authentication method must be enabled
  if (!props.passwordAuth && !props.keyAuth) {
    throw new Error('At least one authentication method (password or key) must be enabled');
  }

  // If key auth is enabled, key file must be specified
  if (props.keyAuth && !props.keyFile) {
    throw new Error('Key file path is required when key authentication is enabled');
  }
}

/**
 * Creates a summary text for SFTP properties (matching Java implementation)
 */
export function getSftpPropertiesSummary(props: SftpSchemeProperties): string {
  const parts: string[] = [];

  // Authentication method
  if (props.passwordAuth && props.keyAuth) {
    parts.push('Password and Public Key');
  } else if (props.keyAuth) {
    parts.push('Public Key');
  } else {
    parts.push('Password');
  }
  parts.push('Authentication');

  // Host key checking
  parts.push('/');
  parts.push('Hostname Checking');
  if (props.hostKeyChecking === 'yes') {
    parts.push('On');
  } else if (props.hostKeyChecking === 'no') {
    parts.push('Off');
  } else {
    parts.push('Ask');
  }

  return parts.join(' ');
}
