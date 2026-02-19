import type { SecretValue, SecretsProvider } from '../types.js';

/**
 * Reads secrets from process.env using three lookup strategies:
 * 1. Exact match: process.env[key]
 * 2. MIRTH_CFG_ prefix: process.env['MIRTH_CFG_' + key]
 * 3. _MP_ prefix (Java Mirth Docker entrypoint compat):
 *    _MP_DATABASE__URL → database-url (strip _MP_, __ → -, _ → ., lowercase)
 */
export class EnvProvider implements SecretsProvider {
  readonly name = 'env';

  async initialize(): Promise<void> {
    // No initialization needed — process.env is always available
  }

  async get(key: string): Promise<SecretValue | undefined> {
    const value = this.resolve(key);
    if (value === undefined) return undefined;
    return {
      value,
      source: this.name,
      fetchedAt: new Date(),
    };
  }

  async has(key: string): Promise<boolean> {
    return this.resolve(key) !== undefined;
  }

  async list(): Promise<string[]> {
    const keys = new Set<string>();
    for (const envKey of Object.keys(process.env)) {
      if (envKey.startsWith('MIRTH_CFG_')) {
        keys.add(envKey.slice('MIRTH_CFG_'.length));
      } else if (envKey.startsWith('_MP_')) {
        keys.add(EnvProvider.mpEnvToKey(envKey));
      }
      // Don't list ALL env vars for exact match — too noisy
    }
    return Array.from(keys);
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  private resolve(key: string): string | undefined {
    // Strategy 1: Exact match
    if (process.env[key] !== undefined) return process.env[key];

    // Strategy 2: MIRTH_CFG_ prefix
    const cfgKey = `MIRTH_CFG_${key}`;
    if (process.env[cfgKey] !== undefined) return process.env[cfgKey];

    // Strategy 3: _MP_ reverse lookup
    const mpKey = this.toMpEnvVar(key);
    if (process.env[mpKey] !== undefined) return process.env[mpKey];

    return undefined;
  }

  /**
   * Convert a config key to _MP_ env var name.
   * e.g., 'database.url' → '_MP_DATABASE_URL'
   * Transformation: replace . with _, - with __, uppercase, prepend _MP_
   */
  private toMpEnvVar(key: string): string {
    return '_MP_' + key.replace(/-/g, '__').replace(/\./g, '_').toUpperCase();
  }

  /**
   * Convert an _MP_ env var back to config key.
   * e.g., '_MP_DATABASE__URL' → 'database-url'
   * Transformation: strip _MP_, replace __ with -, replace _ with ., lowercase
   */
  static mpEnvToKey(envVar: string): string {
    return envVar.replace(/^_MP_/, '').replace(/__/g, '-').replace(/_/g, '.').toLowerCase();
  }
}
