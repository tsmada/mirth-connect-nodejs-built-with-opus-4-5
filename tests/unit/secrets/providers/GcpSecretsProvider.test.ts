import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { GcpSecretsProvider } from '../../../../src/secrets/providers/GcpSecretsProvider.js';

describe('GcpSecretsProvider', () => {
  let provider: GcpSecretsProvider;
  let mockAccessSecretVersion: jest.Mock<(...args: any[]) => Promise<any>>;
  let mockListSecrets: jest.Mock<(...args: any[]) => Promise<any>>;
  let mockClose: jest.Mock<() => Promise<void>>;
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockAccessSecretVersion = jest.fn<(...args: any[]) => Promise<any>>();
    mockListSecrets = jest.fn<(...args: any[]) => Promise<any>>();
    mockClose = jest.fn<() => Promise<void>>();

    provider = new GcpSecretsProvider('my-project');
    // Bypass dynamic import by injecting mock client directly
    (provider as any).client = {
      accessSecretVersion: mockAccessSecretVersion,
      listSecrets: mockListSecrets,
      close: mockClose,
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await provider.shutdown();
  });

  it('should have name "gcp"', () => {
    expect(provider.name).toBe('gcp');
  });

  it('should use GCP_PROJECT_ID env var when no project specified', () => {
    process.env['GCP_PROJECT_ID'] = 'env-project';
    const envProvider = new GcpSecretsProvider();
    expect((envProvider as any).project).toBe('env-project');
  });

  it('should use GOOGLE_CLOUD_PROJECT as fallback', () => {
    delete process.env['GCP_PROJECT_ID'];
    process.env['GOOGLE_CLOUD_PROJECT'] = 'gcloud-project';
    const envProvider = new GcpSecretsProvider();
    expect((envProvider as any).project).toBe('gcloud-project');
  });

  it('should throw if no project ID available on initialize', async () => {
    delete process.env['GCP_PROJECT_ID'];
    delete process.env['GOOGLE_CLOUD_PROJECT'];
    const noProjectProvider = new GcpSecretsProvider();
    await expect(noProjectProvider.initialize()).rejects.toThrow('GCP project ID required');
  });

  describe('get()', () => {
    it('should return string payload', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([{
        payload: { data: 'my-secret-value' },
        name: 'projects/my-project/secrets/db_pass/versions/3',
      }]);

      const result = await provider.get('db_pass');
      expect(result).toBeDefined();
      expect(result!.value).toBe('my-secret-value');
      expect(result!.source).toBe('gcp');
      expect(result!.version).toBe('3');
      expect(result!.fetchedAt).toBeInstanceOf(Date);
      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/my-project/secrets/db_pass/versions/latest',
      });
    });

    it('should handle Buffer payload', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([{
        payload: { data: Buffer.from('buffer-secret') },
        name: 'projects/my-project/secrets/key/versions/1',
      }]);

      const result = await provider.get('key');
      expect(result).toBeDefined();
      expect(result!.value).toBe('buffer-secret');
    });

    it('should return undefined when payload data is null', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([{
        payload: { data: null },
        name: 'projects/my-project/secrets/empty/versions/1',
      }]);

      const result = await provider.get('empty');
      expect(result).toBeUndefined();
    });

    it('should return undefined when payload is missing', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([{
        payload: null,
        name: 'projects/my-project/secrets/no-payload/versions/1',
      }]);

      const result = await provider.get('no-payload');
      expect(result).toBeUndefined();
    });

    it('should return undefined for NOT_FOUND (code 5)', async () => {
      const err = new Error('NOT_FOUND');
      (err as any).code = 5;
      mockAccessSecretVersion.mockRejectedValueOnce(err);

      const result = await provider.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should rethrow non-NOT_FOUND errors', async () => {
      const err = new Error('Permission denied');
      (err as any).code = 7; // PERMISSION_DENIED
      mockAccessSecretVersion.mockRejectedValueOnce(err);

      await expect(provider.get('forbidden')).rejects.toThrow('Permission denied');
    });

    it('should throw if not initialized', async () => {
      const uninit = new GcpSecretsProvider('test');
      await expect(uninit.get('key')).rejects.toThrow('not initialized');
    });
  });

  describe('has()', () => {
    it('should return true when secret exists', async () => {
      mockAccessSecretVersion.mockResolvedValueOnce([{
        payload: { data: 'value' },
        name: 'projects/my-project/secrets/exists/versions/1',
      }]);
      expect(await provider.has('exists')).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      const err = new Error('NOT_FOUND');
      (err as any).code = 5;
      mockAccessSecretVersion.mockRejectedValueOnce(err);
      expect(await provider.has('missing')).toBe(false);
    });
  });

  describe('list()', () => {
    it('should return secret names', async () => {
      mockListSecrets.mockResolvedValueOnce([[
        { name: 'projects/my-project/secrets/secret1' },
        { name: 'projects/my-project/secrets/secret2' },
        { name: 'projects/my-project/secrets/secret3' },
      ]]);

      const keys = await provider.list();
      expect(keys).toEqual(['secret1', 'secret2', 'secret3']);
      expect(mockListSecrets).toHaveBeenCalledWith({
        parent: 'projects/my-project',
      });
    });

    it('should handle empty list', async () => {
      mockListSecrets.mockResolvedValueOnce([[]]);
      const keys = await provider.list();
      expect(keys).toEqual([]);
    });

    it('should handle null secrets', async () => {
      mockListSecrets.mockResolvedValueOnce([null]);
      const keys = await provider.list();
      expect(keys).toEqual([]);
    });

    it('should throw if not initialized', async () => {
      const uninit = new GcpSecretsProvider('test');
      await expect(uninit.list()).rejects.toThrow('not initialized');
    });
  });

  describe('shutdown()', () => {
    it('should call close on client and clear it', async () => {
      await provider.shutdown();
      expect(mockClose).toHaveBeenCalled();
      await expect(provider.get('key')).rejects.toThrow('not initialized');
    });

    it('should handle client without close method', async () => {
      (provider as any).client = { accessSecretVersion: mockAccessSecretVersion };
      await provider.shutdown();
      // Should not throw
      expect((provider as any).client).toBeNull();
    });
  });
});
