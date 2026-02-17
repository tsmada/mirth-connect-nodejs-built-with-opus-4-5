/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/connectors/file/FTPSchemeProperties.java
 *
 * Purpose: Configuration properties specific to FTP/FTPS connections.
 *
 * Key behaviors:
 * - Supports initial FTP commands sent after connection (Java: SITE commands, etc.)
 * - Matches Java default: empty initialCommands list
 */

/**
 * FTP scheme-specific configuration properties.
 */
export interface FtpSchemeProperties {
  /**
   * List of FTP commands to send immediately after login.
   * Java Mirth sends these via client.sendCommand() after authentication.
   * Example: ["SITE UMASK 002", "SITE CHMOD 664"]
   */
  initialCommands: string[];
}

/**
 * Returns default FTP scheme properties matching Java defaults.
 */
export function getDefaultFtpSchemeProperties(): FtpSchemeProperties {
  return {
    initialCommands: [],
  };
}
