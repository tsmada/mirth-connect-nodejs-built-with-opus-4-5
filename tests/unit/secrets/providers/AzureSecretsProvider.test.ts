import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AzureSecretsProvider } from '../../../../src/secrets/providers/AzureSecretsProvider.js';

describe('AzureSecretsProvider', () => {
  let provider: AzureSecretsProvider;
  let mockGetSecret: jest.Mock<(...args: any[]) => Promise<any>>;
  let mockSetSecret: jest.Mock<(...args: any[]) => Promise<any>>;
  let mockBeginDeleteSecret: jest.Mock<(...args: any[]) => Promise<any>>;
  let mockListPropertiesOfSecrets: jest.Mock<(...args: any[]) => any>;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockGetSecret = jest.fn<(...args: any[]) => Promise<any>>();
    mockSetSecret = jest.fn<(...args: any[]) => Promise<any>>();
    mockBeginDeleteSecret = jest.fn<(...args: any[]) => Promise<any>>();
    mockListPropertiesOfSecrets = jest.fn<(...args: any[]) => any>();

    provider = new AzureSecretsProvider('https://my-vault.vault.azure.net');
    // Bypass dynamic import by injecting mock client directly
    (provider as any).client = {
      getSecret: mockGetSecret,
      setSecret: mockSetSecret,
      beginDeleteSecret: mockBeginDeleteSecret,
      listPropertiesOfSecrets: mockListPropertiesOfSecrets,
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await provider.shutdown();
  });

  it('should have name "azure"', () => {
    expect(provider.name).toBe('azure');
  });

  it('should use MIRTH_SECRETS_AZURE_VAULT_URL env var', () => {
    process.env['MIRTH_SECRETS_AZURE_VAULT_URL'] = 'https://env-vault.vault.azure.net';
    const envProvider = new AzureSecretsProvider();
    expect((envProvider as any).vaultUrl).toBe('https://env-vault.vault.azure.net');
  });

  it('should throw if no vault URL available on initialize', async () => {
    delete process.env['MIRTH_SECRETS_AZURE_VAULT_URL'];
    const noUrlProvider = new AzureSecretsProvider();
    await expect(noUrlProvider.initialize()).rejects.toThrow('Azure Key Vault URL required');
  });

  describe('get()', () => {
    it('should return secret value with metadata', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: 'my-secret',
        properties: {
          version: 'abc123',
          expiresOn: '2026-12-31T00:00:00Z',
        },
      });

      const result = await provider.get('db_password');
      expect(result).toBeDefined();
      expect(result!.value).toBe('my-secret');
      expect(result!.source).toBe('azure');
      expect(result!.version).toBe('abc123');
      expect(result!.expiresAt).toBeInstanceOf(Date);
      expect(result!.fetchedAt).toBeInstanceOf(Date);
    });

    it('should normalize underscores to dashes in key names', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: 'value',
        properties: {},
      });

      await provider.get('db_password_main');
      expect(mockGetSecret).toHaveBeenCalledWith('db-password-main');
    });

    it('should return undefined for 404 errors', async () => {
      const err = new Error('Not found');
      (err as any).statusCode = 404;
      mockGetSecret.mockRejectedValueOnce(err);

      const result = await provider.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined for SecretNotFound code', async () => {
      const err = new Error('Secret not found');
      (err as any).code = 'SecretNotFound';
      mockGetSecret.mockRejectedValueOnce(err);

      const result = await provider.get('missing');
      expect(result).toBeUndefined();
    });

    it('should return undefined when value is undefined', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: undefined,
        properties: {},
      });

      const result = await provider.get('empty');
      expect(result).toBeUndefined();
    });

    it('should not include expiresAt when expiresOn is not set', async () => {
      mockGetSecret.mockResolvedValueOnce({
        value: 'value',
        properties: {},
      });

      const result = await provider.get('no_expiry');
      expect(result).toBeDefined();
      expect(result!.expiresAt).toBeUndefined();
    });

    it('should rethrow non-404 errors', async () => {
      const err = new Error('Forbidden');
      (err as any).statusCode = 403;
      mockGetSecret.mockRejectedValueOnce(err);

      await expect(provider.get('forbidden')).rejects.toThrow('Forbidden');
    });

    it('should throw if not initialized', async () => {
      const uninit = new AzureSecretsProvider('https://vault.azure.net');
      await expect(uninit.get('key')).rejects.toThrow('not initialized');
    });
  });

  describe('has()', () => {
    it('should return true when secret exists', async () => {
      mockGetSecret.mockResolvedValueOnce({ value: 'val', properties: {} });
      expect(await provider.has('exists')).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      const err = new Error('Not found');
      (err as any).statusCode = 404;
      mockGetSecret.mockRejectedValueOnce(err);
      expect(await provider.has('missing')).toBe(false);
    });
  });

  describe('list()', () => {
    it('should iterate async iterator and return names', async () => {
      const secrets = [
        { name: 'db-password' },
        { name: 'api-key' },
        { name: 'tls-cert' },
      ];
      mockListPropertiesOfSecrets.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          for (const s of secrets) yield s;
        },
      });

      const keys = await provider.list();
      expect(keys).toEqual(['db-password', 'api-key', 'tls-cert']);
    });

    it('should handle empty list', async () => {
      mockListPropertiesOfSecrets.mockReturnValueOnce({
        [Symbol.asyncIterator]: async function* () {
          // empty
        },
      });

      const keys = await provider.list();
      expect(keys).toEqual([]);
    });

    it('should throw if not initialized', async () => {
      const uninit = new AzureSecretsProvider('https://vault.azure.net');
      await expect(uninit.list()).rejects.toThrow('not initialized');
    });
  });

  describe('set()', () => {
    it('should set secret with normalized key', async () => {
      mockSetSecret.mockResolvedValueOnce({});

      await provider.set!('db_password', 'new-value');
      expect(mockSetSecret).toHaveBeenCalledWith('db-password', 'new-value');
    });
  });

  describe('delete()', () => {
    it('should begin delete and poll until done', async () => {
      const mockPollUntilDone = jest.fn<() => Promise<void>>().mockResolvedValueOnce(undefined);
      mockBeginDeleteSecret.mockResolvedValueOnce({
        pollUntilDone: mockPollUntilDone,
      });

      await provider.delete!('old_secret');
      expect(mockBeginDeleteSecret).toHaveBeenCalledWith('old-secret');
      expect(mockPollUntilDone).toHaveBeenCalled();
    });
  });

  describe('shutdown()', () => {
    it('should clear client on shutdown', async () => {
      await provider.shutdown();
      await expect(provider.get('key')).rejects.toThrow('not initialized');
    });
  });
});
