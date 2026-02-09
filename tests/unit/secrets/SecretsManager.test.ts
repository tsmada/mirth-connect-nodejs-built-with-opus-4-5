import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SecretsManager } from '../../../src/secrets/SecretsManager.js';
import type { SecretValue, SecretsProvider } from '../../../src/secrets/types.js';

// ---------- Mock provider factory ----------

function createMockProvider(name: string, secrets: Record<string, string> = {}): SecretsProvider {
  const store = new Map(Object.entries(secrets));
  return {
    name,
    initialize: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    get: jest.fn<(key: string) => Promise<SecretValue | undefined>>().mockImplementation(
      async (key: string): Promise<SecretValue | undefined> => {
        const value = store.get(key);
        if (value === undefined) return undefined;
        return { value, source: name, fetchedAt: new Date() };
      }
    ),
    has: jest.fn<(key: string) => Promise<boolean>>().mockImplementation(
      async (key: string): Promise<boolean> => store.has(key)
    ),
    list: jest.fn<() => Promise<string[]>>().mockImplementation(
      async (): Promise<string[]> => Array.from(store.keys())
    ),
    shutdown: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

describe('SecretsManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    SecretsManager.resetInstance();
  });

  afterEach(async () => {
    const inst = SecretsManager.getInstance();
    if (inst) await inst.shutdown();
    SecretsManager.resetInstance();
    jest.useRealTimers();
  });

  // ---------- getInstance / singleton ----------

  describe('singleton lifecycle', () => {
    it('should return null before initialize()', () => {
      expect(SecretsManager.getInstance()).toBeNull();
    });

    it('should return the instance after initialize()', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env')],
        { providers: ['env'], cacheTtlSeconds: 0 },
      );

      expect(SecretsManager.getInstance()).toBe(mgr);
    });

    it('should reset instance on shutdown()', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env')],
        { providers: ['env'], cacheTtlSeconds: 0 },
      );

      await mgr.shutdown();
      expect(SecretsManager.getInstance()).toBeNull();
    });
  });

  // ---------- initializeWithProviders ----------

  describe('initializeWithProviders()', () => {
    it('should create manager with given providers', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env'), createMockProvider('file')],
        { providers: ['env', 'file'], cacheTtlSeconds: 0 },
      );

      expect(mgr.getProviderStatus()).toHaveLength(2);
      expect(mgr.getProviderStatus()[0]!.name).toBe('env');
      expect(mgr.getProviderStatus()[1]!.name).toBe('file');
    });

    it('should call initialize() on each provider', async () => {
      const envP = createMockProvider('env');
      const fileP = createMockProvider('file');

      await SecretsManager.initializeWithProviders(
        [envP, fileP],
        { providers: ['env', 'file'], cacheTtlSeconds: 0 },
      );

      expect(envP.initialize).toHaveBeenCalledTimes(1);
      expect(fileP.initialize).toHaveBeenCalledTimes(1);
    });

    it('should skip providers that fail to initialize', async () => {
      const failProvider = createMockProvider('env');
      (failProvider.initialize as jest.MockedFunction<() => Promise<void>>)
        .mockRejectedValue(new Error('boom'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mgr = await SecretsManager.initializeWithProviders(
        [failProvider, createMockProvider('file')],
        { providers: ['env', 'file'], cacheTtlSeconds: 0 },
      );

      // Only 'file' should be registered (env failed)
      expect(mgr.getProviderStatus()).toHaveLength(1);
      expect(mgr.getProviderStatus()[0]!.name).toBe('file');
      consoleSpy.mockRestore();
    });

    it('should preload keys from config', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { 'db.password': 'secret123', 'api.key': 'key456' })],
        { providers: ['env'], cacheTtlSeconds: 0, preloadKeys: ['db.password', 'api.key'] },
      );

      expect(mgr.getSync('db.password')).toBe('secret123');
      expect(mgr.getSync('api.key')).toBe('key456');
    });
  });

  // ---------- resolve ----------

  describe('resolve()', () => {
    it('should return secret from first provider that has the key', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [
          createMockProvider('env', { 'db.password': 'env-value' }),
          createMockProvider('file', { 'db.password': 'file-value' }),
        ],
        { providers: ['env', 'file'], cacheTtlSeconds: 300 },
      );

      const result = await mgr.resolve('db.password');

      expect(result).toBeDefined();
      expect(result!.value).toBe('env-value');
      expect(result!.source).toBe('env');
    });

    it('should fall through to next provider when first returns undefined', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [
          createMockProvider('env', {}),
          createMockProvider('file', { 'db.password': 'file-value' }),
        ],
        { providers: ['env', 'file'], cacheTtlSeconds: 300 },
      );

      const result = await mgr.resolve('db.password');

      expect(result).toBeDefined();
      expect(result!.value).toBe('file-value');
      expect(result!.source).toBe('file');
    });

    it('should return undefined when no provider has the key', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', {})],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      const result = await mgr.resolve('nonexistent');

      expect(result).toBeUndefined();
    });

    it('should cache resolved secrets', async () => {
      const provider = createMockProvider('env', { 'key': 'value' });
      const mgr = await SecretsManager.initializeWithProviders(
        [provider],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      await mgr.resolve('key');
      await mgr.resolve('key');

      // Provider.get should only be called once (second call hits cache)
      expect(provider.get).toHaveBeenCalledTimes(1);
    });

    it('should populate sync cache on resolve', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { 'key': 'value' })],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      await mgr.resolve('key');

      expect(mgr.getSync('key')).toBe('value');
    });

    it('should continue to next provider when one throws', async () => {
      const failProvider = createMockProvider('env');
      (failProvider.get as jest.MockedFunction<(key: string) => Promise<SecretValue | undefined>>)
        .mockRejectedValue(new Error('provider error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mgr = await SecretsManager.initializeWithProviders(
        [failProvider, createMockProvider('file', { 'key': 'fallback' })],
        { providers: ['env', 'file'], cacheTtlSeconds: 300 },
      );
      const result = await mgr.resolve('key');

      expect(result).toBeDefined();
      expect(result!.value).toBe('fallback');
      consoleSpy.mockRestore();
    });
  });

  // ---------- getSync ----------

  describe('getSync()', () => {
    it('should return undefined for uncached keys', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env')],
        { providers: ['env'], cacheTtlSeconds: 0 },
      );

      expect(mgr.getSync('unknown')).toBeUndefined();
    });

    it('should return value from sync cache after resolve()', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { 'key': 'cached-value' })],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      await mgr.resolve('key');

      expect(mgr.getSync('key')).toBe('cached-value');
    });
  });

  // ---------- preload ----------

  describe('preload()', () => {
    it('should load specified keys into sync cache', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { a: '1', b: '2', c: '3' })],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      await mgr.preload(['a', 'c']);

      expect(mgr.getSync('a')).toBe('1');
      expect(mgr.getSync('b')).toBeUndefined();
      expect(mgr.getSync('c')).toBe('3');
    });

    it('should skip keys that no provider has', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { a: '1' })],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      await mgr.preload(['a', 'missing']);

      expect(mgr.getSync('a')).toBe('1');
      expect(mgr.getSync('missing')).toBeUndefined();
    });

    it('should log errors for failed preloads without throwing', async () => {
      const provider = createMockProvider('env');
      (provider.get as jest.MockedFunction<(key: string) => Promise<SecretValue | undefined>>)
        .mockRejectedValue(new Error('boom'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const mgr = await SecretsManager.initializeWithProviders(
        [provider],
        { providers: ['env'], cacheTtlSeconds: 0 },
      );
      // Should not throw
      await mgr.preload(['broken-key']);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ---------- provider priority ----------

  describe('provider priority', () => {
    it('should respect provider order as priority (earlier = higher)', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [
          createMockProvider('env', { 'shared': 'from-env' }),
          createMockProvider('file', { 'shared': 'from-file', 'file-only': 'file-value' }),
        ],
        { providers: ['env', 'file'], cacheTtlSeconds: 300 },
      );

      const shared = await mgr.resolve('shared');
      expect(shared!.value).toBe('from-env');
      expect(shared!.source).toBe('env');

      const fileOnly = await mgr.resolve('file-only');
      expect(fileOnly!.value).toBe('file-value');
      expect(fileOnly!.source).toBe('file');
    });
  });

  // ---------- getProviderStatus ----------

  describe('getProviderStatus()', () => {
    it('should list all initialized providers', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env'), createMockProvider('file')],
        { providers: ['env', 'file'], cacheTtlSeconds: 0 },
      );

      const status = mgr.getProviderStatus();

      expect(status).toEqual([
        { name: 'env', initialized: true },
        { name: 'file', initialized: true },
      ]);
    });

    it('should return empty array with no providers', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [],
        { providers: [], cacheTtlSeconds: 0 },
      );

      expect(mgr.getProviderStatus()).toEqual([]);
    });
  });

  // ---------- getCacheStats ----------

  describe('getCacheStats()', () => {
    it('should return cache statistics', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { 'key': 'value' })],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );

      await mgr.resolve('key');
      await mgr.resolve('key');      // cache hit
      await mgr.resolve('missing');  // cache miss (not in provider either)

      const stats = mgr.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(1);
      // At least 1 miss for 'missing'
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------- shutdown ----------

  describe('shutdown()', () => {
    it('should call shutdown on all providers', async () => {
      const envP = createMockProvider('env');
      const fileP = createMockProvider('file');
      const mgr = await SecretsManager.initializeWithProviders(
        [envP, fileP],
        { providers: ['env', 'file'], cacheTtlSeconds: 0 },
      );

      await mgr.shutdown();

      expect(envP.shutdown).toHaveBeenCalled();
      expect(fileP.shutdown).toHaveBeenCalled();
    });

    it('should clear sync cache on shutdown', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env', { 'key': 'value' })],
        { providers: ['env'], cacheTtlSeconds: 300 },
      );
      await mgr.resolve('key');
      expect(mgr.getSync('key')).toBe('value');

      await mgr.shutdown();

      expect(mgr.getSync('key')).toBeUndefined();
    });

    it('should nullify the singleton', async () => {
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env')],
        { providers: ['env'], cacheTtlSeconds: 0 },
      );
      expect(SecretsManager.getInstance()).toBe(mgr);

      await mgr.shutdown();

      expect(SecretsManager.getInstance()).toBeNull();
    });
  });

  // ---------- refresh timer ----------

  describe('refresh timer', () => {
    it('should refresh sync cache on timer tick', async () => {
      const provider = createMockProvider('env', { 'key': 'initial' });
      const mgr = await SecretsManager.initializeWithProviders(
        [provider],
        { providers: ['env'], cacheTtlSeconds: 60 },
      );

      // Populate sync cache
      await mgr.resolve('key');
      expect(mgr.getSync('key')).toBe('initial');

      // Change the provider return value
      (provider.get as jest.MockedFunction<(key: string) => Promise<SecretValue | undefined>>)
        .mockImplementation(async (k: string): Promise<SecretValue | undefined> => {
          if (k === 'key') return { value: 'refreshed', source: 'env', fetchedAt: new Date() };
          return undefined;
        });

      // Advance timer past TTL to trigger refresh
      jest.advanceTimersByTime(60 * 1000);

      // Allow the async refresh callback (Promise.allSettled) to settle
      // Multiple microtask ticks needed for Promise chains
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mgr.getSync('key')).toBe('refreshed');
    });

    it('should not start timer when cacheTtlSeconds is 0', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      const callCountBefore = setIntervalSpy.mock.calls.length;

      await SecretsManager.initializeWithProviders(
        [createMockProvider('env')],
        { providers: ['env'], cacheTtlSeconds: 0 },
      );

      // No new setInterval calls should have been made for the refresh timer
      const newCalls = setIntervalSpy.mock.calls.slice(callCountBefore);
      const refreshCall = newCalls.find(
        call => typeof call[1] === 'number' && call[1] === 0
      );
      expect(refreshCall).toBeUndefined();
      setIntervalSpy.mockRestore();
    });

    it('should clear timer on shutdown', async () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const mgr = await SecretsManager.initializeWithProviders(
        [createMockProvider('env')],
        { providers: ['env'], cacheTtlSeconds: 60 },
      );

      await mgr.shutdown();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
