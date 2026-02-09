/**
 * ConfigMapBackend -- bridges SecretsManager into ConfigurationMap.
 *
 * When wired as a fallback, $cfg('DB_PASSWORD') transparently resolves
 * from the vault provider chain if the key isn't found in the database.
 */
import { SecretsManager } from '../SecretsManager.js';

/**
 * Creates a synchronous fallback function for ConfigurationMap.get().
 * Returns a function that reads from SecretsManager.getSync(key).
 */
export function createConfigMapFallback(): (key: string) => unknown | undefined {
  return (key: string): unknown | undefined => {
    const mgr = SecretsManager.getInstance();
    if (!mgr) return undefined;
    return mgr.getSync(key);
  };
}
