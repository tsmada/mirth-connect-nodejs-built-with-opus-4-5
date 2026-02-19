/**
 * SecretsManager — singleton orchestrator for secret resolution.
 *
 * Ties all SecretsProvider implementations together with a priority chain,
 * async SecretCache, and a synchronous Map<string, string> for use in
 * script scopes ($cfg(), $secrets()).
 *
 * Pattern matches GlobalMap / ConfigurationMap singletons in MirthMap.ts.
 */
import { SecretCache, type CacheStats } from './SecretCache.js';
import type { SecretValue, SecretsProvider, SecretsManagerConfig } from './types.js';
import { parseSecretsConfig } from './types.js';
import { getLogger, registerComponent } from '../logging/index.js';

registerComponent('secrets', 'Secret management');
const logger = getLogger('secrets');

let instance: SecretsManager | null = null;

export class SecretsManager {
  private providers: SecretsProvider[] = [];
  private cache: SecretCache;
  private syncCache = new Map<string, string>();
  private config: SecretsManagerConfig;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(config: SecretsManagerConfig) {
    this.config = config;
    const encryptionKey = config.encryptCache ? process.env['MIRTH_ENCRYPTION_KEY'] : undefined;
    this.cache = new SecretCache(config.cacheTtlSeconds, encryptionKey);
  }

  /**
   * Initialize the singleton. Parses config from env vars, creates providers
   * via dynamic imports, initializes each one, and preloads configured keys.
   */
  static async initialize(): Promise<SecretsManager> {
    const config = parseSecretsConfig();
    const mgr = new SecretsManager(config);

    // Create and initialize providers in config order (order = priority)
    for (const type of config.providers) {
      try {
        const provider = await SecretsManager.createProvider(type, config);
        await provider.initialize();
        mgr.providers.push(provider);
      } catch (err) {
        logger.error(`Failed to initialize provider '${type}': ${(err as Error).message}`);
        // Continue with remaining providers — partial availability is better than total failure
      }
    }

    // Preload configured keys into sync cache
    if (config.preloadKeys && config.preloadKeys.length > 0) {
      await mgr.preload(config.preloadKeys);
    }

    // Start background refresh timer
    mgr.startRefreshTimer();

    instance = mgr;
    return mgr;
  }

  /**
   * Initialize with pre-built providers (for testing and programmatic use).
   * Skips the dynamic import factory — callers provide already-constructed providers.
   */
  static async initializeWithProviders(
    providers: SecretsProvider[],
    config?: Partial<SecretsManagerConfig>
  ): Promise<SecretsManager> {
    const baseConfig = parseSecretsConfig();
    const mergedConfig: SecretsManagerConfig = { ...baseConfig, ...config };
    const mgr = new SecretsManager(mergedConfig);

    for (const provider of providers) {
      try {
        await provider.initialize();
        mgr.providers.push(provider);
      } catch (err) {
        logger.error(`Failed to initialize provider '${provider.name}': ${(err as Error).message}`);
      }
    }

    if (mergedConfig.preloadKeys && mergedConfig.preloadKeys.length > 0) {
      await mgr.preload(mergedConfig.preloadKeys);
    }

    mgr.startRefreshTimer();
    instance = mgr;
    return mgr;
  }

  /**
   * Get the singleton instance, or null if not yet initialized.
   */
  static getInstance(): SecretsManager | null {
    return instance;
  }

  /**
   * Reset the singleton (for testing).
   */
  static resetInstance(): void {
    instance = null;
  }

  /**
   * Resolve a secret by walking the provider priority chain.
   * First provider to return a value wins. Result is cached.
   */
  async resolve(key: string): Promise<SecretValue | undefined> {
    // Check async cache first
    const cached = this.cache.get(key);
    if (cached) return cached;

    // Walk provider chain
    for (const provider of this.providers) {
      try {
        const secret = await provider.get(key);
        if (secret) {
          this.cache.set(key, secret);
          this.syncCache.set(key, secret.value);
          return secret;
        }
      } catch (err) {
        logger.error(
          `Provider '${provider.name}' error for key '${key}': ${(err as Error).message}`
        );
        // Continue to next provider
      }
    }

    return undefined;
  }

  /**
   * Synchronous read from the pre-populated sync cache.
   * Used by $cfg() and $secrets() in script scope where await is not available.
   */
  getSync(key: string): string | undefined {
    return this.syncCache.get(key);
  }

  /**
   * Eagerly load specific keys into the sync cache.
   */
  async preload(keys: string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.map(async (key) => {
        const secret = await this.resolve(key);
        if (secret) {
          this.syncCache.set(key, secret.value);
        }
      })
    );

    // Log any failures without blocking startup
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === 'rejected') {
        logger.error(`Failed to preload key '${keys[i]}': ${result.reason}`);
      }
    }
  }

  /**
   * Get initialization status of all providers (for /api/secrets/status).
   */
  getProviderStatus(): Array<{ name: string; initialized: boolean }> {
    return this.providers.map((p) => ({
      name: p.name,
      initialized: true, // If it's in the array, it initialized successfully
    }));
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /**
   * Clean shutdown — clear timers, shut down all providers.
   */
  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }

    await Promise.allSettled(this.providers.map((p) => p.shutdown()));

    this.syncCache.clear();
    this.cache.invalidateAll();
    instance = null;
  }

  /**
   * Factory: create a provider instance by type string.
   * Uses dynamic imports so cloud SDK dependencies are only loaded when needed.
   */
  private static async createProvider(
    type: string,
    config: SecretsManagerConfig
  ): Promise<SecretsProvider> {
    switch (type) {
      case 'env': {
        const { EnvProvider } = await import('./providers/EnvProvider.js');
        return new EnvProvider();
      }
      case 'file': {
        const { FileProvider } = await import('./providers/FileProvider.js');
        return new FileProvider(config.filePath);
      }
      case 'props': {
        if (!config.configFile)
          throw new Error('PropertiesFileProvider requires MIRTH_CONFIG_FILE');
        const { PropertiesFileProvider } = await import('./providers/PropertiesFileProvider.js');
        return new PropertiesFileProvider(config.configFile);
      }
      case 'aws': {
        const { AwsSecretsProvider } = await import('./providers/AwsSecretsProvider.js');
        return new AwsSecretsProvider(config.awsRegion, config.awsPrefix);
      }
      case 'gcp': {
        const { GcpSecretsProvider } = await import('./providers/GcpSecretsProvider.js');
        return new GcpSecretsProvider(config.gcpProject);
      }
      case 'azure': {
        const { AzureSecretsProvider } = await import('./providers/AzureSecretsProvider.js');
        return new AzureSecretsProvider(config.azureVaultUrl);
      }
      case 'vault': {
        const { VaultSecretsProvider } = await import('./providers/VaultSecretsProvider.js');
        return new VaultSecretsProvider({
          addr: config.vaultAddr ?? '',
          token: config.vaultToken,
          path: config.vaultPath,
          auth: config.vaultAuth,
          roleId: config.vaultRoleId,
          secretId: config.vaultSecretId,
          k8sRole: config.vaultK8sRole,
        });
      }
      default:
        throw new Error(`Unknown secrets provider: ${type}`);
    }
  }

  /**
   * Start periodic refresh of the sync cache.
   * Uses .unref() so the timer doesn't prevent process exit.
   */
  private startRefreshTimer(): void {
    if (this.config.cacheTtlSeconds <= 0) return;
    this.refreshTimer = setInterval(() => {
      this.refreshSyncCache().catch((err) =>
        logger.error('[SecretsManager] Sync cache refresh failed', err as Error)
      );
    }, this.config.cacheTtlSeconds * 1000);
    if (
      this.refreshTimer &&
      typeof this.refreshTimer === 'object' &&
      'unref' in this.refreshTimer
    ) {
      this.refreshTimer.unref();
    }
  }

  /**
   * Re-resolve all keys currently in the sync cache.
   * Called periodically by the refresh timer.
   */
  private async refreshSyncCache(): Promise<void> {
    const keys = Array.from(this.syncCache.keys());
    if (keys.length === 0) return;

    // Invalidate the async cache entries so resolve() re-fetches from providers
    for (const key of keys) {
      this.cache.invalidate(key);
    }

    await this.preload(keys);
  }
}
