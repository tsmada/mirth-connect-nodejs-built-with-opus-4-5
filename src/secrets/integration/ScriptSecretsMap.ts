/**
 * ScriptSecretsMap -- provides $secrets(key) for user scripts.
 *
 * Unlike $cfg() which checks the database ConfigurationMap first,
 * $secrets() goes directly to the vault provider chain.
 */
import { SecretsManager } from '../SecretsManager.js';

/**
 * Read-only map for script scope. Throws on write operations.
 */
export class SecretsMap {
  get(key: string): string | undefined {
    const mgr = SecretsManager.getInstance();
    if (!mgr) return undefined;
    return mgr.getSync(key);
  }

  containsKey(key: string): boolean {
    return this.get(key) !== undefined;
  }

  put(_key: string, _value: unknown): never {
    throw new Error('$secrets is read-only. Use the vault provider API to write secrets.');
  }
}

/**
 * Create the $secrets() shorthand function for script scope.
 */
export function createSecretsFunction(): (key: string) => string | undefined {
  const map = new SecretsMap();
  return (key: string): string | undefined => map.get(key);
}

/**
 * Create a SecretsMap instance for scope binding.
 */
export function createSecretsMap(): SecretsMap {
  return new SecretsMap();
}
