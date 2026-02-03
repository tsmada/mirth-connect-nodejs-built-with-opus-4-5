/**
 * Ported from: ~/Projects/connect/server/src/com/mirth/connect/server/userutil/SMTPConnectionFactory.java
 *
 * Purpose: Factory to create SMTPConnection using server's default SMTP settings
 *
 * Key behaviors to replicate:
 * - createSMTPConnection() - Creates an SMTPConnection with default server settings
 */

import { SMTPConnection } from './SMTPConnection.js';

/**
 * Server SMTP configuration interface.
 * This represents the configuration stored in the server settings.
 */
export interface SMTPConfig {
  host: string;
  port: string;
  timeout?: number;
  useAuthentication: boolean;
  secure: string; // "TLS", "SSL", or ""
  username: string;
  password: string;
  from: string;
}

/**
 * Default SMTP configuration store.
 * In a real implementation, this would be loaded from server configuration.
 */
let defaultConfig: SMTPConfig | null = null;

/**
 * Utility class used to create SMTPConnection objects using the server's default SMTP settings.
 */
export class SMTPConnectionFactory {
  private constructor() {
    // Private constructor - static utility class
  }

  /**
   * Sets the default SMTP configuration for the factory.
   * This should be called during server initialization with the server's SMTP settings.
   *
   * @param config - The default SMTP configuration.
   */
  static setDefaultConfig(config: SMTPConfig): void {
    defaultConfig = config;
  }

  /**
   * Gets the current default SMTP configuration.
   *
   * @returns The current default SMTP configuration, or null if not set.
   */
  static getDefaultConfig(): SMTPConfig | null {
    return defaultConfig;
  }

  /**
   * Clears the default SMTP configuration.
   * Primarily used for testing.
   */
  static clearDefaultConfig(): void {
    defaultConfig = null;
  }

  /**
   * Creates an SMTPConnection object using the server's default SMTP settings.
   *
   * @returns The instantiated SMTPConnection object.
   * @throws Error if the SMTP connection could not be created (e.g., no default config).
   */
  static createSMTPConnection(): SMTPConnection {
    if (!defaultConfig) {
      throw new Error(
        'SMTP configuration not set. Call SMTPConnectionFactory.setDefaultConfig() first.'
      );
    }

    const timeout = defaultConfig.timeout ?? 60000;

    return new SMTPConnection(
      defaultConfig.host,
      defaultConfig.port,
      timeout,
      defaultConfig.useAuthentication,
      defaultConfig.secure,
      defaultConfig.username,
      defaultConfig.password,
      defaultConfig.from
    );
  }
}
