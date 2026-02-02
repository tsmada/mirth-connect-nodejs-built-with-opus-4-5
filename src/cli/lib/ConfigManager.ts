/**
 * Configuration Manager
 *
 * Manages CLI configuration stored in ~/.mirth-cli.json
 * Uses the 'conf' package for cross-platform config file handling.
 */

import Conf from 'conf';
import { CliConfig } from '../types/index.js';

/**
 * Default configuration values
 */
const defaults: CliConfig = {
  url: 'http://localhost:8081',
  outputFormat: 'table',
  dashboardRefresh: 5,
};

/**
 * Configuration store using 'conf' package
 *
 * The config file is stored at:
 * - macOS: ~/Library/Preferences/mirth-cli-nodejs/config.json
 * - Windows: %APPDATA%/mirth-cli-nodejs/Config/config.json
 * - Linux: ~/.config/mirth-cli-nodejs/config.json
 */
const config = new Conf<CliConfig>({
  projectName: 'mirth-cli',
  defaults,
  // Migration could be added here in the future if config schema changes
});

/**
 * ConfigManager provides typed access to CLI configuration
 */
export const ConfigManager = {
  /**
   * Get the full configuration
   */
  getAll(): CliConfig {
    return config.store;
  },

  /**
   * Get a specific configuration value
   */
  get<K extends keyof CliConfig>(key: K): CliConfig[K] {
    return config.get(key);
  },

  /**
   * Set a configuration value
   */
  set<K extends keyof CliConfig>(key: K, value: CliConfig[K]): void {
    config.set(key, value);
  },

  /**
   * Set multiple configuration values at once
   */
  setMany(values: Partial<CliConfig>): void {
    for (const [key, value] of Object.entries(values)) {
      if (value !== undefined) {
        config.set(key as keyof CliConfig, value);
      }
    }
  },

  /**
   * Delete a configuration value (reset to default)
   */
  delete<K extends keyof CliConfig>(key: K): void {
    config.delete(key);
  },

  /**
   * Reset all configuration to defaults
   */
  reset(): void {
    config.clear();
  },

  /**
   * Get the path to the config file
   */
  getPath(): string {
    return config.path;
  },

  // ==========================================================================
  // Session-specific helpers
  // ==========================================================================

  /**
   * Save session after successful login
   */
  saveSession(token: string, expiryMs: number = 24 * 60 * 60 * 1000): void {
    config.set('sessionToken', token);
    config.set('sessionExpiry', Date.now() + expiryMs);
  },

  /**
   * Clear session (logout)
   */
  clearSession(): void {
    config.delete('sessionToken');
    config.delete('sessionExpiry');
  },

  /**
   * Check if session is valid (exists and not expired)
   */
  hasValidSession(): boolean {
    const token = config.get('sessionToken');
    const expiry = config.get('sessionExpiry');

    if (!token || !expiry) {
      return false;
    }

    return Date.now() < expiry;
  },

  /**
   * Get the current session token if valid
   */
  getSessionToken(): string | undefined {
    if (this.hasValidSession()) {
      return config.get('sessionToken');
    }
    return undefined;
  },

  // ==========================================================================
  // URL helpers
  // ==========================================================================

  /**
   * Get the effective server URL (from config or default)
   */
  getServerUrl(): string {
    return config.get('url') || defaults.url;
  },

  /**
   * Set the server URL
   */
  setServerUrl(url: string): void {
    // Normalize URL (remove trailing slash)
    const normalizedUrl = url.replace(/\/+$/, '');
    config.set('url', normalizedUrl);
  },
};

export default ConfigManager;
