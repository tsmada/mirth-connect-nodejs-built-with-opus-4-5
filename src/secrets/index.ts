// Core
export { SecretCache } from './SecretCache.js';
export type { CacheStats } from './SecretCache.js';
export { SecretsManager } from './SecretsManager.js';
export { parseSecretsConfig } from './types.js';
export type { SecretValue, SecretsProvider, SecretsManagerConfig } from './types.js';

// Local providers (always available)
export { EnvProvider } from './providers/EnvProvider.js';
export { FileProvider } from './providers/FileProvider.js';
export { PropertiesFileProvider } from './providers/PropertiesFileProvider.js';

// Cloud providers NOT re-exported -- use dynamic import

// Integration
export { createConfigMapFallback } from './integration/ConfigMapBackend.js';
export { resolveSecretReferences } from './integration/VariableResolverPlugin.js';
export {
  createSecretsFunction,
  createSecretsMap,
  SecretsMap,
} from './integration/ScriptSecretsMap.js';
