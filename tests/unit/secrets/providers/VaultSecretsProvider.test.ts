import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// Mock axios
const mockGet = jest.fn<(...args: any[]) => Promise<any>>();
const mockPost = jest.fn<(...args: any[]) => Promise<any>>();
const mockDelete = jest.fn<(...args: any[]) => Promise<any>>();
const mockAxiosCreate = jest.fn().mockReturnValue({
  get: mockGet,
  post: mockPost,
  delete: mockDelete,
});

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: mockAxiosCreate,
  },
}));

// Mock fs/promises for kubernetes auth
const mockReadFile = jest.fn<(...args: any[]) => Promise<string>>();
jest.mock('fs/promises', () => ({
  readFile: mockReadFile,
}));

import { VaultSecretsProvider } from '../../../../src/secrets/providers/VaultSecretsProvider.js';
import type { VaultConfig } from '../../../../src/secrets/providers/VaultSecretsProvider.js';

describe('VaultSecretsProvider', () => {
  let provider: VaultSecretsProvider;

  const defaultConfig: VaultConfig = {
    addr: 'http://127.0.0.1:8200',
    token: 's.test-token',
    auth: 'token',
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // Health check succeeds by default
    mockGet.mockResolvedValueOnce({ status: 200, data: { initialized: true, sealed: false } });
    provider = new VaultSecretsProvider(defaultConfig);
    await provider.initialize();
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('should have name "vault"', () => {
    expect(provider.name).toBe('vault');
  });

  it('should throw if no address provided', async () => {
    const noAddr = new VaultSecretsProvider({ addr: '' });
    await expect(noAddr.initialize()).rejects.toThrow('Vault address required');
  });

  it('should throw if token auth with no token', async () => {
    const noToken = new VaultSecretsProvider({ addr: 'http://vault:8200', auth: 'token' });
    await expect(noToken.initialize()).rejects.toThrow('Vault token required');
  });

  it('should perform health check on initialize', async () => {
    expect(mockGet).toHaveBeenCalledWith('/v1/sys/health', expect.objectContaining({
      headers: { 'X-Vault-Token': 's.test-token' },
    }));
  });

  it('should throw if health check fails', async () => {
    jest.clearAllMocks();
    mockGet.mockRejectedValueOnce(new Error('Connection refused'));
    const badVault = new VaultSecretsProvider(defaultConfig);
    await expect(badVault.initialize()).rejects.toThrow('Vault health check failed');
  });

  describe('token auth', () => {
    it('should use provided token', async () => {
      // Already initialized in beforeEach with token auth
      expect(mockAxiosCreate).toHaveBeenCalledWith({
        baseURL: 'http://127.0.0.1:8200',
        timeout: 5000,
      });
    });
  });

  describe('approle auth', () => {
    it('should login with role_id and secret_id', async () => {
      jest.clearAllMocks();

      // AppRole login response
      mockPost.mockResolvedValueOnce({
        data: { auth: { client_token: 's.approle-token' } },
      });
      // Health check
      mockGet.mockResolvedValueOnce({ status: 200 });

      const approleProvider = new VaultSecretsProvider({
        addr: 'http://vault:8200',
        auth: 'approle',
        roleId: 'my-role-id',
        secretId: 'my-secret-id',
      });
      await approleProvider.initialize();

      expect(mockPost).toHaveBeenCalledWith('/v1/auth/approle/login', {
        role_id: 'my-role-id',
        secret_id: 'my-secret-id',
      });
      await approleProvider.shutdown();
    });

    it('should throw if roleId or secretId missing for approle', async () => {
      jest.clearAllMocks();
      const noRole = new VaultSecretsProvider({
        addr: 'http://vault:8200',
        auth: 'approle',
      });
      await expect(noRole.initialize()).rejects.toThrow('AppRole requires roleId and secretId');
    });
  });

  describe('kubernetes auth', () => {
    it('should login with service account token', async () => {
      jest.clearAllMocks();

      // Read k8s service account token
      mockReadFile.mockResolvedValueOnce('k8s-jwt-token');
      // Kubernetes login response
      mockPost.mockResolvedValueOnce({
        data: { auth: { client_token: 's.k8s-token' } },
      });
      // Health check
      mockGet.mockResolvedValueOnce({ status: 200 });

      const k8sProvider = new VaultSecretsProvider({
        addr: 'http://vault:8200',
        auth: 'kubernetes',
        k8sRole: 'mirth-role',
      });
      await k8sProvider.initialize();

      expect(mockReadFile).toHaveBeenCalledWith(
        '/var/run/secrets/kubernetes.io/serviceaccount/token',
        'utf-8'
      );
      expect(mockPost).toHaveBeenCalledWith('/v1/auth/kubernetes/login', {
        role: 'mirth-role',
        jwt: 'k8s-jwt-token',
      });
      await k8sProvider.shutdown();
    });

    it('should throw if k8sRole missing for kubernetes auth', async () => {
      jest.clearAllMocks();
      const noRole = new VaultSecretsProvider({
        addr: 'http://vault:8200',
        auth: 'kubernetes',
      });
      await expect(noRole.initialize()).rejects.toThrow('Kubernetes auth requires k8sRole');
    });
  });

  describe('get()', () => {
    it('should read KV v2 path with X-Vault-Token header', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          data: {
            data: { value: 'my-secret' },
            metadata: { version: 3 },
          },
        },
      });

      const result = await provider.get('db_password');
      expect(result).toBeDefined();
      expect(result!.value).toBe('my-secret');
      expect(result!.source).toBe('vault');
      expect(result!.version).toBe('3');
      expect(result!.fetchedAt).toBeInstanceOf(Date);
      expect(mockGet).toHaveBeenCalledWith(
        '/v1/secret/data/mirth/db_password',
        { headers: { 'X-Vault-Token': 's.test-token' } }
      );
    });

    it('should extract single "value" key from secret data', async () => {
      mockGet.mockResolvedValueOnce({
        data: {
          data: {
            data: { value: 'simple-value' },
            metadata: { version: 1 },
          },
        },
      });

      const result = await provider.get('key');
      expect(result!.value).toBe('simple-value');
    });

    it('should JSON-stringify multi-key secret data', async () => {
      const multiData = { user: 'admin', pass: 'secret', port: 5432 };
      mockGet.mockResolvedValueOnce({
        data: {
          data: {
            data: multiData,
            metadata: { version: 2 },
          },
        },
      });

      const result = await provider.get('db_config');
      expect(result!.value).toBe(JSON.stringify(multiData));
    });

    it('should return undefined for 404', async () => {
      const err = new Error('Not found');
      (err as any).response = { status: 404 };
      mockGet.mockRejectedValueOnce(err);

      const result = await provider.get('nonexistent');
      expect(result).toBeUndefined();
    });

    it('should return undefined when data is empty', async () => {
      mockGet.mockResolvedValueOnce({
        data: { data: { data: null } },
      });

      const result = await provider.get('empty');
      expect(result).toBeUndefined();
    });

    it('should rethrow non-404 errors', async () => {
      const err = new Error('Forbidden');
      (err as any).response = { status: 403 };
      mockGet.mockRejectedValueOnce(err);

      await expect(provider.get('forbidden')).rejects.toThrow('Forbidden');
    });

    it('should throw if not initialized', async () => {
      const uninit = new VaultSecretsProvider(defaultConfig);
      await expect(uninit.get('key')).rejects.toThrow('not initialized');
    });
  });

  describe('has()', () => {
    it('should return true when secret exists', async () => {
      mockGet.mockResolvedValueOnce({
        data: { data: { data: { value: 'v' }, metadata: {} } },
      });
      expect(await provider.has('exists')).toBe(true);
    });

    it('should return false when secret does not exist', async () => {
      const err = new Error('Not found');
      (err as any).response = { status: 404 };
      mockGet.mockRejectedValueOnce(err);
      expect(await provider.has('missing')).toBe(false);
    });
  });

  describe('list()', () => {
    it('should read metadata path with list=true', async () => {
      mockGet.mockResolvedValueOnce({
        data: { data: { keys: ['secret1', 'secret2', 'secret3'] } },
      });

      const keys = await provider.list();
      expect(keys).toEqual(['secret1', 'secret2', 'secret3']);
      expect(mockGet).toHaveBeenCalledWith('/v1/secret/metadata/mirth', {
        headers: { 'X-Vault-Token': 's.test-token' },
        params: { list: true },
      });
    });

    it('should return empty array for 404', async () => {
      const err = new Error('Not found');
      (err as any).response = { status: 404 };
      mockGet.mockRejectedValueOnce(err);

      const keys = await provider.list();
      expect(keys).toEqual([]);
    });

    it('should throw if not initialized', async () => {
      const uninit = new VaultSecretsProvider(defaultConfig);
      await expect(uninit.list()).rejects.toThrow('not initialized');
    });
  });

  describe('set()', () => {
    it('should write to KV v2 path', async () => {
      mockPost.mockResolvedValueOnce({});

      await provider.set!('db_password', 'new-value');
      expect(mockPost).toHaveBeenCalledWith(
        '/v1/secret/data/mirth/db_password',
        { data: { value: 'new-value' } },
        { headers: { 'X-Vault-Token': 's.test-token' } }
      );
    });
  });

  describe('delete()', () => {
    it('should delete via metadata path', async () => {
      mockDelete.mockResolvedValueOnce({});

      await provider.delete!('old_secret');
      expect(mockDelete).toHaveBeenCalledWith(
        '/v1/secret/metadata/mirth/old_secret',
        { headers: { 'X-Vault-Token': 's.test-token' } }
      );
    });
  });

  describe('shutdown()', () => {
    it('should clear http client and token', async () => {
      await provider.shutdown();
      await expect(provider.get('key')).rejects.toThrow('not initialized');
    });
  });

  describe('custom path', () => {
    it('should use custom KV v2 mount path', async () => {
      jest.clearAllMocks();
      mockGet.mockResolvedValueOnce({ status: 200 }); // health check

      const customProvider = new VaultSecretsProvider({
        addr: 'http://vault:8200',
        token: 's.token',
        path: 'kv/data/myapp',
      });
      await customProvider.initialize();

      mockGet.mockResolvedValueOnce({
        data: { data: { data: { value: 'custom' }, metadata: {} } },
      });

      await customProvider.get('key');
      expect(mockGet).toHaveBeenCalledWith(
        '/v1/kv/data/myapp/key',
        expect.objectContaining({ headers: { 'X-Vault-Token': 's.token' } })
      );
      await customProvider.shutdown();
    });
  });
});
